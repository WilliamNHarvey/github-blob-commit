var extend = require('xtend')
var async = require('async')
var Octokat = require('octokat')
var fs = require('file-system')

/**
 * A mixin for [Octokat.js](https://github.com/philschatz/octokat.js) that
 * provides a simple wrapper for writing to and reading from a repo. It
 * replicates node.js `fs.readFile` and `fs.writeFile`. It has a few special
 * features:
 *
 * 1. **Minimize requests**
 *
 *     By default it tries to use the Github [contents
 * API](https://developer.github.com/v3/repos/contents/) to read, write with a
 * single request and update a file with 3 requests: (a) tries to write; (b)
 * gets sha for existing file; (c) writes update
 *
 * 2. **Read and update large files**
 *
 *     The contents API cannot read or update files larger than 1Mb. Hubfs
 * switches to the [git API](https://developer.github.com/v3/git/) to read and
 * update files up to 100Mb
 *
 * 3. **Simultaneous writes**
 *
 *     Repeatedly writing to the contents API [will result in an
 * error](http://stackoverflow.com/questions/19576601/github-api-issue-with-file-upload)
 * because of delays updating the HEAD, and making multiple simultaneous
 * writes will result in the same problem of Fast Forward commits. Hubfs will
 * automatically queue up requests and switch to using the git API for
 * multiple parallel writes. It will batch together multiple writes to the
 * same repo in commits of up to 10 files, but will make commits as quickly as
 * it can.
 *
 * **Limitations**
 *
 * - Repeat writes do not currently respect `options.flags='wx'` (they will
 * overwrite existing files)
 *
 * - Maximum batch size for commits cannot be changed, awaiting [upstream
 * async issue](https://github.com/caolan/async/pull/740)
 *
 * ### Breaking change in v1.0.0
 *
 * No longer operates as a Octokat mixin, instead new instances are created
 * with an `options` object with the owner, repo and auth, which is passed
 * to Octokat.
 *
 * @param  {Object} options `options.owner` Github repo owner, `options.repo`
 * repo name, `options.auth` (optional) passed through to a new
 * [Octokat instance](https://github.com/philschatz/octokat.js#in-a-browser)
 * @return {Object}      returns and instance of Hubfs with two methods
 * `readFile` and `writeFile`.
 * @example
 * var Hubfs = require('Hubfs')
 *
 * var options = {
 *   owner: 'github_username',
 *   repo: 'github_repo_name'
 *   auth: {
 *     username: "USER_NAME",
 *     password: "PASSWORD"
 *   }
 * }
 *
 * var gh = Hubfs(options)
 */
function githubBlobCommit (options) {
  if (!(this instanceof githubBlobCommit)) {
    return new githubBlobCommit(options)
  }
  options = options || {}
  if (!options.owner) {
    throw new Error('Must provide Github repo owner options.owner')
  }
  if (!options.repo) {
    throw new Error('Must provide Github repo name options.repo')
  }
  this._repo = new Octokat(options.auth).repos(options.owner, options.repo)
  this._reponame = options.owner + '/' + options.repo
}

/**
 * @param  {Array}   files    {Object} {path[, content]}
 * @param  {String|Buffer}   data
 * @param  {Object}   [options] `options.encoding='utf8'` `options.flag='w'`
 * default will overwrite, `'wx'` will fail if path exists. `options.message` Commit message. `options.branch='master'` branch to write to.
 * @param  {Function} callback
 * @example
 * gh.writeFile('message.txt', 'Hello Github', function (err) {
 *   if (err) throw err
 *   console.log('It\'s saved!')
 * })
 */
githubBlobCommit.prototype.commitFiles = function commitFiles (files, branch, callback) {
  errs = "";
  if (typeof files !== 'array') {
    errs += "Need files array\n"
  }
  if (typeof branch !== 'string') {
    errs += "Need a branch\n"
  }
  if (typeof callback !== 'function') {
    errs += "Need a callback\n"
  }
  if (errs.length) {
    throw new Error(errs)
  }

  hashed = [];
  for (var file in files) {
    if(file.content) {
      var contentBuffer = new Buffer(file.content, "utf8");
    }
    else {
      var contentBuffer = new Buffer(fs.readFileSync(__dirname+"/../../"+file, "utf8"), "utf8");
    }
    fileBlob = this._createBlob.call({
      path: "schemas/docs/"+file,
      content: contentBuffer.toString('base64')
    };
    hashed.push(fileBlob);
  }

  this._commit.call(hashed, branch, callback)
}

/**
 * @function
 * @private
 * Receives base64 encoded content and creates a new blob on the repo,
 * returning the sha
 * @param  {Sting}   content  `base64` encoded content
 * @param  {Function} callback called with new blob sha
 */
githubBlobCommit.prototype._createBlob = function _createBlob (params, callback) {
  var input = {
    content: params.content,
    encoding: 'base64'
  }
  var file = {
    path: params.path,
    message: params.message
  }
  this._repo.git.blobs.create(input, function (err, response) {
    if (err) return callback(err)
    file.sha = response.sha
    callback(null, file)
  })
}

/**
 * @function
 * @private
 * Makes a new commit from an array of blob shas and updates the branch HEAD.
 * @param  {Array}   files    Array of `file` Objects with properties
 * `file.sha` and `file.path` and optional `file.message` commit message
 * @param  {String}   branch   Branch to commit to
 * @param  {Function} callback Called with ref to new head
 */
githubBlobCommit.prototype._commit = function (files, branch, callback) {
  var _repo = this._repo
  async.waterfall([
    _repo.git.refs('heads/' + branch).fetch,
    function (ref, cb) {
      _repo.git.commits(ref.object.sha).fetch(cb)
    },
    function (commit, cb) {
      cb(null, commit.sha, commit.tree.sha)
    },
    function (commitSha, treeSha, cb) {
      var newTree = {
        base_tree: treeSha,
        tree: files.map(function (file) {
          return {
            path: file.path,
            mode: '100644',
            type: 'blob',
            sha: file.sha
          }
        })
      }
      _repo.git.trees.create(newTree, function (err, tree) {
        cb(err, commitSha, tree.sha)
      })
    },
    function (commitSha, treeSha, cb) {
      var newCommit = {
        tree: treeSha,
        parents: [ commitSha ],
        message: files.reduce(function (prev, curr) {
          return prev + curr.path + ': ' + (curr.message || '') + '\n'
        }, 'Added new files\n\n')
      }
      _repo.git.commits.create(newCommit, cb)
    },
    function (commit, cb) {
      var newRef = {
        sha: commit.sha,
        force: true
      }
      _repo.git.refs('heads/' + branch).update(newRef, cb)
    }
  ], callback)
}

module.exports = githubBlobCommit
