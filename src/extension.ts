import * as vscode from 'vscode';
import * as child_process from 'child_process';

export function activate(context: vscode.ExtensionContext) {
	// 获取当前打开的工作空间的根目录路径
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		throw new Error('No workspace is open.');
	}
	const repoPath = workspaceFolders[0].uri.fsPath;

	let disposable = vscode.commands.registerCommand('git-branches.all-branches', async () => {
		try {
			// 获取Git分支列表
			const branches = await getGitBranches(repoPath);
			const currentBranch = await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: repoPath });
			const items = branches.map(branch => ({
				...branch,
				label: branch.fullName,
				description: branch.fullName === currentBranch ? `✓` : undefined
			} as (vscode.QuickPickItem & Branch)));

			// 显示分支列表
			const selectedBranchItem = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select a git branch to operate on'
			});
			const selectedBranch = selectedBranchItem?.label;
			if (selectedBranch) {
				let actions: string[] = [];
				if (selectedBranch != currentBranch) {
					actions.push('checkout');
					if (checkIfGitlensInstalled()) {
						actions.push('compare');
					}
					actions.push('merge');
				}
				if (!selectedBranchItem.isRemote) {
					// 如果分支不是远程分支，允许 update 和 push
					actions.push('update', 'push');
				}
				if (selectedBranch != currentBranch) {
					actions.push('delete');
				}
				const selectedAction = await vscode.window.showQuickPick(actions, {
					placeHolder: 'Choose an action to perform on the branch'
				});

				// 执行选择的操作
				if (selectedAction) {
					await performGitAction(repoPath, currentBranch, selectedBranchItem as Branch, selectedAction, branches);
				}
			}
		} catch (error) {
			if (error instanceof Error) {
				vscode.window.showErrorMessage(`Error: ${error.message}`);
			} else {
				vscode.window.showErrorMessage(`An unknown error occurred.`);
			}
		}
	});

	context.subscriptions.push(disposable);
}

interface Branch {
	shortName: string;
	fullName: string;
	isRemote: boolean;
	remote?: string;
}
async function getGitBranches(repoPath: string): Promise<Branch[]> {
	return new Promise<Branch[]>(async (resolve, reject) => {
		// 在根目录下执行git命令
		const gitCommand = 'git branch --list --all';
		const branches = (await execPromise(gitCommand, { cwd: repoPath }))
			.split('\n').filter(b => b).map(b => b.trim().replace('* ', ''))
			.filter(b => !b.startsWith('remotes/origin/HEAD'))
			.map(function (b) {
				const match = b.match(/^remotes\/([^\/]+)\/(.+)$/);
				let isRemote = false;
				if (match) {
					isRemote = true;
				}
				return {
					shortName: isRemote ? (match as RegExpMatchArray)[2] : b,
					fullName: b,
					isRemote: isRemote,
					remote: isRemote ? (match as RegExpMatchArray)[1] : undefined,
				} as Branch;
			})
		resolve(branches);
	});
}

function checkIfGitlensInstalled(): boolean {
	const gitLensExtension = vscode.extensions.getExtension('eamodio.gitlens');
	const gitlessExtension = vscode.extensions.getExtension('maattdd.gitless');
	if ((gitLensExtension && gitLensExtension.isActive) || (gitlessExtension && gitlessExtension.isActive)) {
		return true;
	} else {
		return false;
	}
}

async function performGitAction(repoPath: string, currentBranch: string, selectedBranch: Branch, action: string, branches: Branch[]) {
	let isVscodeCommand = false;
	let gitCommand = '';
	let args: any[] = [];

	let remote, remoteBranch;
	switch (action) {
		case 'checkout':
			gitCommand = await checkoutBranchCommand(repoPath, selectedBranch, branches);
			break;
		case 'compare':
			isVscodeCommand = true;
			gitCommand = `gitlens.compareHeadWith`;
			// 参考：https://github.com/maattdd/vscode-gitlens/blob/7603222a45a78b753d64bf4f0f323d2d5cdb12cc/src/commands/compareWith.ts#L10
			args.push({ ref1: '', ref2: selectedBranch.fullName });
			break;
		case 'merge':
			gitCommand = `git merge ${selectedBranch.fullName}`;
			break;
		case 'update':
			// 当前分支命令不同
			if (selectedBranch.fullName === currentBranch) {
				gitCommand = `git pull`;
			} else {
				[remote, remoteBranch] = await getRemoteBranch(repoPath, selectedBranch);
				gitCommand = `git fetch ${remote} ${remoteBranch}:${selectedBranch.fullName}`;
			}
			break;
		case 'push':
			[remote, remoteBranch] = await getRemoteBranch(repoPath, selectedBranch);
			gitCommand = `git push ${remote} ${selectedBranch.fullName}:${remoteBranch}`;
			break;
		case 'delete':
			if (selectedBranch.isRemote) {
				let remoteBranch = selectedBranch.fullName.replace('remotes/', '');
				gitCommand = `git push --delete ${remoteBranch.split('/')[0]} ${remoteBranch.split('/')[1]}`;
			} else {
				gitCommand = `git branch -D ${selectedBranch.fullName}`;
			}
			break;
		default:
			throw new Error('Unsupported action');
	}

	if (gitCommand) {
		// vscode.window.showInformationMessage(`Performing ${action} on ${selectedBranch.fullName}: ${gitCommand}`);
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Performing ${action} on ${selectedBranch.fullName}`,
			cancellable: false
		}, async (progress) => {
			return new Promise<void>((resolve, reject) => {
				if (isVscodeCommand) {
					vscode.commands.executeCommand(gitCommand, ...args).then(() => {
						resolve();
					}, (reason) => {
						reject(reason);
					})
					return;
				}
				child_process.exec(gitCommand, { cwd: repoPath }, (error, stdout, stderr) => {
					if (error) {
						vscode.window.showErrorMessage(`Git ${action} failed: ${stderr}`);
						reject(error);
					} else {
						vscode.window.showInformationMessage(`Git ${action} successful${stdout ? ': ' + stdout : '.'}`);
						resolve();
					}
				});
			});
		});
	}
}

async function getRemoteBranch(repoPath: string, localBranch: Branch): Promise<string[]> {
	return new Promise<string[]>((resolve, reject) => {
		child_process.exec(`git for-each-ref --format=%(upstream) refs/heads/${localBranch.fullName}`, { cwd: repoPath }, (err, stdout, stderr) => {
			if (err) {
				vscode.window.showErrorMessage('Error: ' + stderr);
				return;
			}

			// 输出跟踪的远程分支
			const upstream = stdout.trim();
			const match = upstream.match(/^refs\/remotes\/([^\/]+)\/(.+)$/);
			if (match) {
				resolve([match[1], match[2]]);
			} else {
				reject(new Error('No remote branch found for ' + localBranch.fullName));
			}
		});
	});
}

async function checkoutBranchCommand(repoPath: string, selectedBranch: Branch, branches: Branch[]): Promise<string> {
	if (!selectedBranch.isRemote) {
		return `git checkout ${selectedBranch.fullName}`;
	}

	// 提示用户输入本地分支名称
	const defaultLocalBranchName = selectedBranch.shortName;
	const inputLocalBranchName = await vscode.window.showInputBox({
		prompt: 'Enter a name for your new local branch',
		value: defaultLocalBranchName,
	});
	if (!inputLocalBranchName) {
		return '';
	}

	if (branches.map(b => b.fullName).includes(inputLocalBranchName)) {
		// 如果本地分支已存在，切换到该分支
		vscode.window.showInformationMessage(`Switching to existing branch ${inputLocalBranchName}.`);
		return `git checkout ${inputLocalBranchName}`;
	} else {
		// 如果本地分支不存在，创建并切换到该分支
		return `git checkout -b ${inputLocalBranchName} ${selectedBranch.fullName}`;
	}
}

function execPromise(command: string, options: child_process.ExecOptions): Promise<string> {
	return new Promise((resolve, reject) => {
		child_process.exec(command, options, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr));
			} else {
				resolve(stdout.trim());
			}
		});
	});
}

export function deactivate() { }