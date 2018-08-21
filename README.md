# github-blob-commit
https://www.npmjs.com/package/github-blob-commit

Single commit for multiple files


### `githubBlobCommit(options)`

Uses [Octokat.js](https://github.com/philschatz/octokat.js)

### Parameters

| parameter | type   | description                                                                                                                                                                              |
| --------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options` | Object | `options.owner` Github repo owner, `options.repo` repo name, `options.auth` (optional) passed through to a new
[Octokat instance](https://github.com/philschatz/octokat.js#in-a-browser) |


### Example

```js
var githubBlobCommit = require('github-blob-commit')

var options = {
  owner: 'github_username',
  repo: 'github_repo_name'
  auth: {
    username: "USER_NAME",
    password: "PASSWORD"
    //Or token: "TOKEN"
  }
}

var gh = githubBlobCommit(options)
```

```
filesToCommit = [];
fs.readdir("/files/", (err, files) => {
  files.forEach(file => {
    filesToCommit.push({
      path: "/files/"+file,
      content: fs.readFileSync("/files/"+file, "utf8") //optional
    })
  });
  gh.commitFiles(filesToCommit, "github_repo_branch", function(err, data) {
    console.log("Committed");
  })
});
```

## Installation

```sh
$ npm install --save github-blob-commit
```

