const fs = require('fs');
const { execSync } = require('child_process');

function getCurrentVersion() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return packageJson.version;
}

function checkWorkingDirectory() {
  try {
    const status = execSync('git status --porcelain').toString().trim();
    const modifiedFiles = status.split('\n').map(line => line.trim().split(' ')[1]);
    const allowedFiles = ['CHANGELOG.md', 'package.json'];
    const invalidFiles = modifiedFiles.filter(file => !allowedFiles.includes(file));
    
    if (invalidFiles.length > 0) {
      console.error(`Error: Unexpected files modified: ${invalidFiles.join(', ')}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('Error checking git status:', error.message);
    process.exit(1);
  }
}

function gitCommitAndTag() {
  const version = getCurrentVersion();
  checkWorkingDirectory();
  try {
    execSync('git add CHANGELOG.md package.json');
    execSync(`git commit -m "Release version ${version}"`);
    execSync(`git tag -a v${version} -m "Release version ${version}"`);
    console.log(`Version ${version} has been committed and tagged.`);
  } catch (error) {
    console.error('Error creating git commit and tag:', error.message);
    process.exit(1);
  }
}

function main() {
  gitCommitAndTag();
}

if (require.main === module) {
  main();
}