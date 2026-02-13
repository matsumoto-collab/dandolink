const fs = require('fs');
const path = require('path');

const coverageFile = path.resolve('coverage/coverage-final.json');
if (!fs.existsSync(coverageFile)) {
    console.log('Coverage file not found');
    process.exit(1);
}

const coverage = JSON.parse(fs.readFileSync(coverageFile, 'utf8'));

let financeStoreCoverage = null;
for (const key in coverage) {
    if (key.includes('financeStore.ts')) {
        financeStoreCoverage = coverage[key];
        break;
    }
}

if (!financeStoreCoverage) {
    console.log('No coverage found for financeStore.ts');
    // List available keys to help debugging
    console.log('Available keys:', Object.keys(coverage).map(k => path.basename(k)));
    process.exit(1);
}

const branches = financeStoreCoverage.b;
let totalBranches = 0;
let coveredBranches = 0;

for (const key in branches) {
    const branch = branches[key];
    totalBranches += branch.length;
    coveredBranches += branch.filter(count => count > 0).length;
}

const percentage = totalBranches === 0 ? 100 : (coveredBranches / totalBranches) * 100;
console.log(`Branch Coverage: ${percentage.toFixed(2)}%`);
console.log(`Total Branches: ${totalBranches}, Covered: ${coveredBranches}`);

if (percentage >= 60) {
    console.log('PASS');
} else {
    console.log('FAIL');
}
