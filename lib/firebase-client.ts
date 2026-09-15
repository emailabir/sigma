// Served only as /auth/firebase.js. Passwords go directly to the Firebase SDK.
// Pin the official CDN SDK; no analytics or database SDK is loaded.
export const firebaseClient=String.raw`
const message=document.querySelector('#message');
const form=document.querySelector('#credentials');
const email=document.querySelector('#email');
const password=document.querySelector('#password');
const show=text=>{message.textContent=text;message.hidden=false;};
let busy=false;
const run=async action=>{if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await action();}catch(error){
 const code=error?.code;
 const messages={
  'auth/invalid-credential':'The email or password is incorrect. Try again or reset your password.',
  'auth/wrong-password':'The email or password is incorrect.',
  'auth/user-not-found':'The email or password is incorrect.',
  'auth/email-already-in-use':'An account already exists. Sign in or reset your password.',
  'auth/weak-password':'Choose a stronger password with at least 12 characters.',
  'auth/password-does-not-meet-requirements':'Your password does not meet the security requirements.',
  'auth/invalid-email':'Enter a valid email address.',
  'auth/too-many-requests':'Too many attempts. Please wait before trying again.',
  'auth/popup-blocked':'Allow the Google sign-in popup, then try again.',
  'auth/popup-closed-by-user':'Google sign-in was cancelled. You can try again.',
  'auth/account-exists-with-different-credential':'Sign in using your existing account method first.',
  'auth/unauthorized-domain':'This app address has not been enabled for sign-in. Contact the Sigma owner.',
  'auth/operation-not-allowed':'This sign-in method is not enabled yet. Contact the Sigma owner.',
  'auth/network-request-failed':'Could not reach the sign-in service. Check your connection and try again.'
 };
 show(messages[code]||'Sign-in could not be completed. Please try again.');
}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}};
try{
 const [{initializeApp},sdk]=await Promise.all([
  import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
  import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js')
 ]);
 const config=JSON.parse(document.querySelector('#firebase-config').textContent);
 const auth=sdk.getAuth(initializeApp(config));
 await sdk.setPersistence(auth,sdk.browserSessionPersistence);
 await auth.authStateReady();
 const settings={url:location.origin+'/auth/login',handleCodeInApp:false};
 async function finish(user){
  await sdk.reload(user);
  if(!user.emailVerified){show('Verify your email before entering Sigma. Check your inbox, then click “I verified my email”.');document.querySelector('#verification').hidden=false;return;}
  const idToken=await sdk.getIdToken(user,true);
  const response=await fetch('/auth/firebase/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken})});
  const result=await response.json();
  if(!response.ok){await sdk.signOut(auth);document.querySelector('#verification').hidden=true;show(result.error||'Unable to sign in.');return;}
  location.replace('/');
 }
 form.addEventListener('submit',event=>{event.preventDefault();run(async()=>{const result=await sdk.signInWithEmailAndPassword(auth,email.value.trim(),password.value);password.value='';await finish(result.user);});});
 document.querySelector('#create').addEventListener('click',()=>run(async()=>{
  if(!form.reportValidity())return;
  if(password.value.length<12){show('Choose a password with at least 12 characters.');return;}
  const result=await sdk.createUserWithEmailAndPassword(auth,email.value.trim(),password.value);password.value='';
  document.querySelector('#verification').hidden=false;
  await sdk.sendEmailVerification(result.user,settings);
  show('Account created. Check your email for a verification link, then return here. Sigma access still requires an invitation.');
 }));
 document.querySelector('#google').addEventListener('click',()=>run(async()=>{
  const provider=new sdk.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
  const result=await sdk.signInWithPopup(auth,provider);await finish(result.user);
 }));
 document.querySelector('#reset').addEventListener('click',()=>run(async()=>{
  if(!email.reportValidity())return;
  try{await sdk.sendPasswordResetEmail(auth,email.value.trim(),settings);}catch(error){if(error?.code!=='auth/user-not-found')throw error;}
  show('If an account uses that email, you will receive a password-reset link. Check your inbox and spam folder.');
 }));
 document.querySelector('#verified').addEventListener('click',()=>run(async()=>{if(auth.currentUser)await finish(auth.currentUser);else show('Sign in first, then verify your email.');}));
 document.querySelector('#resend').addEventListener('click',()=>run(async()=>{if(!auth.currentUser){show('Sign in first to request verification.');return;}await sdk.sendEmailVerification(auth.currentUser,settings);show('Verification email requested. Check your inbox and spam folder.');}));
 if(new URLSearchParams(location.search).get('signedOut')==='1'){await sdk.signOut(auth);history.replaceState(null,'','/auth/login');show('You have signed out.');}
 else if(auth.currentUser)await run(()=>finish(auth.currentUser));
 document.querySelectorAll('button').forEach(b=>b.disabled=false);
}catch{show('Could not load secure sign-in. Check your connection or browser content blocker, then reload.');}
`;
