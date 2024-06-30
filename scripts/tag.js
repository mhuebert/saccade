const fs = require('fs');
const { execSync } = require('child_process');

function getCurrentVersion() {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  return packageJson.version;
}

function checkWorkingDirectory() {
  try {
    const status = execSync('git status --porcelain').toString().trim();
    if (status !== '') {
      console.error('Error: There are uncommitted changes in the working directory.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error checking git status:', error.message);
    process.exit(1);
  }
}

function gitTag() {
  const version = getCurrentVersion();
  checkWorkingDirectory();
  try {
    execSync(`git tag -a v${version} -m "Release version ${version}"`);
    console.log(`Version ${version} has been tagged.`);
  } catch (error) {
    console.error('Error creating git tag:', error.message);
    process.exit(1);
  }
}

function main() {
  gitTag();
}

if (require.main === module) {
  main();
}