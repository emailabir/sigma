import fs from 'node:fs';
const mode=process.env.SIGMA_AUTH_MODE||'github';
if(!['github','email'].includes(mode))throw new Error('SIGMA_AUTH_MODE must be github or email.');
const names=['ALPACA_API_KEY_ID','ALPACA_API_SECRET_KEY',...(mode==='email'?['SIGMA_BREVO_API_KEY','SIGMA_EMAIL_FROM']:['SIGMA_GITHUB_CLIENT_ID','SIGMA_GITHUB_CLIENT_SECRET'])];
if(mode==='email'){
 for(const name of ['SIGMA_BREVO_API_KEY','SIGMA_EMAIL_FROM'])if(!process.env[name]?.trim())throw new Error(`Add the ${name} repository secret before enabling email login.`);
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(process.env.SIGMA_EMAIL_FROM))throw new Error('SIGMA_EMAIL_FROM must contain only a verified sender email address.');
}
const path='dist/server/wrangler.json',config=JSON.parse(fs.readFileSync(path,'utf8'));
config.vars={...config.vars,SIGMA_AUTH_MODE:mode};
fs.writeFileSync(path,JSON.stringify(config));
if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`runtime_secrets<<SIGMA_SECRET_NAMES\n${names.join('\n')}\nSIGMA_SECRET_NAMES\n`);
console.log(`Prepared ${mode} login deployment; runtime credentials stay out of client assets.`);
