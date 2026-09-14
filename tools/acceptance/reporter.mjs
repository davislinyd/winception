import fs from 'node:fs';
import { writeReport } from './report.mjs';
export default class AcceptanceReporter {
  constructor(){this.passed=0;this.failed=0;this.skipped=0;}
  onTestEnd(test,result){
    if(result.status === 'skipped')this.skipped++;
    else if(result.status === test.expectedStatus)this.passed++;
    else this.failed++;
  }
  onEnd(result){
    let cleanup='Failed';
    try {const saved=JSON.parse(fs.readFileSync('test-results/acceptance-ui-cleanup.json'));if(saved.runId === process.env.WINCEPTION_UI_RUN_ID)cleanup=saved.status;}catch{}
    writeReport('test-results/acceptance-ui-report',{layer:'UI',status:result.status === 'passed' && cleanup === 'Passed' ? 'Passed':'Failed',
      passed:this.passed,failed:this.failed,skipped:this.skipped,cleanup,browser:process.env.PLAYWRIGHT_CHANNEL ?? 'chromium',
      installed:'NotRun',vm:'NotRun',physical:'NotRun',human:'NotRun'});
  }
}
