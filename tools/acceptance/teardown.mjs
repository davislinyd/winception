import fs from 'node:fs';
export default async function teardown() {
  const response=await fetch('http://127.0.0.1:4173/preview-cleanup',{
    method:'POST',headers:{'x-preview-run':process.env.WINCEPTION_UI_RUN_ID},signal:AbortSignal.timeout(5000),
  });
  if(!response.ok)throw new Error('Owned preview State cleanup failed');
  fs.mkdirSync('test-results',{recursive:true});
  fs.writeFileSync('test-results/acceptance-ui-cleanup.json',JSON.stringify({runId:process.env.WINCEPTION_UI_RUN_ID,status:'Passed'}));
}
