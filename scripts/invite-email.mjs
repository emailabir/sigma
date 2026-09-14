import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
const args=process.argv.slice(2),email=args[0]?.trim().toLowerCase();
if(!email||email.length>254||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)||email.startsWith('.')||email.includes('..')||email.includes('.@'))throw new Error('Usage: node scripts/invite-email.mjs EMAIL [EXISTING_USER_ID]. Enter a valid email.');
if(args.length>2)throw new Error('Too many arguments.');
const userId=args[1]||`email:${crypto.randomUUID()}`;
if(!/^(github:[1-9][0-9]{0,19}|email:[a-zA-Z0-9-]{1,64})$/.test(userId))throw new Error('Invalid account ID.');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
// A plain INSERT fails on conflicts. Never silently merge/reassign accounts.
const sql=`INSERT INTO email_identities (email,user_id,enabled) VALUES (${quote(email)},${quote(userId)},1);`;
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','sigma-db','--remote','--config','wrangler.jsonc','--command',sql],{env:{...process.env,WRANGLER_WRITE_LOGS:'false'},encoding:'utf8'});
if(result.status!==0){console.error('Could not create invitation. Check Cloudflare authentication, apply migrations, and check whether the email or account ID is already linked.');process.exit(1);}
console.log('Invitation created. The user must verify their email to sign in. No email has been sent.');
