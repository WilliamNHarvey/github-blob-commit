var extend = require('xtend')
var async = require('async')
var Octokat = require('octokat')
var fs = require('file-system')

/*
 * @param  {Object} options `options.owner` Github repo owner, `options.repo`
 * repo name, `options.auth` (optional) passed through to a new
 * [Octokat instance](https://github.com/philschatz/octokat.js#in-a-browser)
 * @return {Object}      returns and instance of githubBlobCommit with commitFiles
 * @example
 * var githubBlobCommit = require('github-blob-commit')
 *
 * var options = {
 *   owner: 'github_username',
 *   repo: 'github_repo_name'
 *   auth: {
 *     username: "USER_NAME",
 *     password: "PASSWORD"
 *     // Or token: "TOKEN"
 *   }
 * }
 *
 * var gh = githubBlobCommit(options)
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
 * @param  {String}   branch
 * @param  {Function} callback
 * @param  {String}   message (optional)
 * @example
 * gh.commitFiles(files, 'github_repo_branch', function() {
 *   console.log('Committed')
 * })
 */
githubBlobCommit.prototype.commitFiles = function commitFiles (files, branch, callback, message) {
  errs = "";
  if (typeof files !== 'object') {
    errs += "Need files array\n"
  }
  if (typeof branch !== 'string') {
    errs += "Need a branch\n"
  }
  if (typeof callback !== 'function') {
    errs += "Need a callback\n"
  }
  if (typeof message !== 'string') {
    message = 'Added following files:';
  }
  if (errs.length) {
    throw new Error(errs)
  }
  var _this = this;
  hashed = [];
  blobPromises = [];

  for(var i = 0; i < files.length; i++) {
    if(files[i].content) {
      var contentBuffer = new Buffer(files[i].content, "utf8");
    }
    else {
      var contentBuffer = new Buffer(fs.readFileSync(__dirname+"/../../"+files[i].path, "utf8"), "utf8");
    }

    blobPromises.push(new Promise(resolve => {
      fileBlob = _this._createBlob.call(_this, {
        path: files[i].path,
        content: contentBuffer.toString('base64')
      }, function(hashedFile) {
        hashed.push(hashedFile);
        resolve();
      });
    }));
  }

  Promise.all(blobPromises).then(function(values) {
    _this._commit.call(_this, hashed, branch, message, callback);
  });
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
    callback(file)
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
githubBlobCommit.prototype._commit = function (files, branch, message, callback) {
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
          return prev + curr.path + (curr.message ? ': ' + curr.message : '') + '\n'
        }, message+'\n\n')
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
