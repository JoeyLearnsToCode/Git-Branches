# Git Branches

## Features

Provide a more convenient view of branch operations.
This plugin defines a command `git-branches.all-branches` that can be used to list all branches in the repository, and then several most useful operation on them.

Available operations for non-current branches include:
- `checkout`
- `compare` (requires GitLens or Gitless extension, or it won't show up)
- `merge`
- `delete` (there is no confirm, so be careful!)

Available operations for local branches include:
- `update`
- `push`

## Usage

You can use it by typing `git-branches.all-branches` or `All Branches` in the command palette.
Or you can bind it to a keyboard shortcut, which I suggest.

## Changelog

### 1.0.3

- When push a local branch whose upstream is set to a different name remote branch, it will be pushed to a new remote branch with same name, and its upstream will be set to the new remote branch.

### 1.0.4

- Make checkout action on remote branch more reasonable

### 1.0.5

- Make push action more reasonable

## License

Feel free to do anything with this plugin.
Glad it helps.

**Enjoy!**
