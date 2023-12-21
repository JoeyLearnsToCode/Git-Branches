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
				label: branch,
				description: branch === currentBranch ? `*` : undefined
			}));

			// 显示分支列表
			const selectedItem = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select a git branch to operate on'
			});
			const selectedBranch = selectedItem?.label;

			// 如果有选择，显示操作菜单
			if (selectedBranch) {
				const actions = ['checkout', 'merge', 'delete'];
				const selectedAction = await vscode.window.showQuickPick(actions, {
					placeHolder: 'Choose an action to perform on the branch'
				});

				// 执行选择的操作
				if (selectedAction) {
					await performGitAction(repoPath, selectedBranch, selectedAction, branches);
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

async function getGitBranches(repoPath: string): Promise<string[]> {
	return new Promise<string[]>(async (resolve, reject) => {
		// 在根目录下执行git命令
		const gitCommand = 'git branch --list --all';
		const branches = (await execPromise(gitCommand, { cwd: repoPath })).split('\n').filter(b => b).map(b => b.trim().replace('* ', ''));
		resolve(branches);
	});
}

async function performGitAction(repoPath: string, selectedBranch: string, action: string, branches: string[]) {
	let gitCommand = '';

	switch (action) {
		case 'checkout':
			gitCommand = await checkoutBranchCommand(repoPath, selectedBranch, branches);
			break;
		case 'merge':
			gitCommand = `git merge ${selectedBranch}`;
			break;
		case 'delete':
			if (selectedBranch.startsWith('remotes/')) {
				let remoteBranch = selectedBranch.replace('remotes/', '');
				gitCommand = `git push --delete ${remoteBranch.split('/')[0]} ${remoteBranch.split('/')[1]}`;
			} else {
				gitCommand = `git branch -D ${selectedBranch}`;
			}
			break;
		default:
			throw new Error('Unsupported action');
	}

	if (gitCommand) {
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Performing ${action} on ${selectedBranch}`,
			cancellable: false
		}, async (progress) => {
			return new Promise<void>((resolve, reject) => {
				child_process.exec(gitCommand, { cwd: repoPath }, (error, stdout, stderr) => {
					if (error) {
						vscode.window.showErrorMessage(`Git ${action} failed: ${stderr}`);
						reject(error);
					} else {
						vscode.window.showInformationMessage(`Git ${action} successful: ${stdout}`);
						resolve();
					}
				});
			});
		});
	}
}

async function checkoutBranchCommand(repoPath: string, selectedBranch: string, branches: string[]): Promise<string> {
	if (!selectedBranch.startsWith('remotes/')) {
		return `git checkout ${selectedBranch}`;
	}

	// 提示用户输入本地分支名称
	const defaultLocalBranchName = selectedBranch.replace(/^remotes\/[^\/]+\//, '');
	const inputLocalBranchName = await vscode.window.showInputBox({
		prompt: 'Enter a name for your new local branch',
		value: defaultLocalBranchName,
	});
	if (!inputLocalBranchName) {
		return '';
	}

	if (branches.includes(inputLocalBranchName)) {
		// 如果本地分支已存在，切换到该分支
		vscode.window.showInformationMessage(`Switching to existing branch ${inputLocalBranchName}.`);
		return `git checkout ${inputLocalBranchName}`;
	} else {
		// 如果本地分支不存在，创建并切换到该分支
		return `git checkout -b ${inputLocalBranchName} ${selectedBranch}`;
	}
}

function execPromise(command: string, options: child_process.ExecOptions) : Promise<string> {
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