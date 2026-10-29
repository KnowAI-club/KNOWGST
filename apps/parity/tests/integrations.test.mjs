import test from 'node:test';
import assert from 'node:assert/strict';
import {initGoogleDrive,ensureToken,isConnected,disconnect,findOrCreateFolder,uploadJSON,uploadPDF} from '../src/services/googleDrive.js';
import {openWhatsAppShare,sanitizeWhatsAppPhone} from '../src/utils/share.js';

test('Drive authorization, escaped folder search and failed requests',async t=>{
  const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
  let requests=[];
  globalThis.window={google:{accounts:{oauth2:{initTokenClient(config){return {requestAccessToken(){config.callback({access_token:'test-only-token',expires_in:3600});}}},revoke(){}}}}};
  try {
    assert.equal((await initGoogleDrive('test-client')).success,true);assert.equal(isConnected(),true);
    await t.test('folder query escapes apostrophes and backslashes',async()=>{
      globalThis.fetch=async(url,options)=>{requests.push({url,options});return Response.json({files:[{id:'folder-1'}]});};
      assert.equal(await findOrCreateFolder("Owner's \\ Books"),'folder-1');
      const query=new URL(requests[0].url).searchParams.get('q');
      assert.ok(query.includes("Owner\\'s \\\\ Books"));
    });
    await t.test('failed search does not create a duplicate folder',async()=>{
      let count=0;globalThis.fetch=async()=>{count++;return Response.json({error:{message:'Quota exceeded'}},{status:429});};
      await assert.rejects(()=>findOrCreateFolder('Books'),/Quota exceeded/);assert.equal(count,1);
    });
    await t.test('upload failure is visible; valid JSON is multipart encoded',async()=>{
      globalThis.fetch=async()=>Response.json({error:{message:'Denied'}},{status:403});
      await assert.rejects(()=>uploadJSON('backup.json','{}','folder-1'),/Denied/);
      globalThis.fetch=async(url,options)=>{assert.ok(options.body.includes('"parents":["folder-1"]'));assert.ok(options.body.includes('{"amount":118}'));return Response.json({id:'upload-1'});};
      assert.equal((await uploadJSON('backup.json','{"amount":118}','folder-1')).id,'upload-1');
    });
    await t.test('PDF upload preserves binary content; expired authorization is rejected',async()=>{
      const previousReader=globalThis.FileReader;
      globalThis.FileReader=class { async readAsDataURL(blob) { this.result='data:application/pdf;base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');this.onload(); } };
      try {
        globalThis.fetch=async(url,options)=>{
          assert.ok(url.includes('uploadType=multipart'));
          assert.ok(options.body.includes(Buffer.from('%PDF-1.7\nfixture').toString('base64')));
          assert.ok(options.body.includes('"name":"invoice.pdf"'));
          return Response.json({id:'pdf-1'});
        };
        assert.equal((await uploadPDF('invoice.pdf',new Blob(['%PDF-1.7\nfixture']),'folder-1')).id,'pdf-1');
        globalThis.fetch=async()=>new Response('Expired',{status:401});
        await assert.rejects(()=>uploadJSON('backup.json','{}','folder-1'),/401/);
        assert.equal(isConnected(),false);
        await assert.rejects(()=>uploadJSON('backup.json','{}','folder-1'),/Not connected/);
      } finally {globalThis.FileReader=previousReader;}
    });
    await t.test('popup errors settle authorization instead of hanging',async()=>{
      disconnect();
      window.google.accounts.oauth2.initTokenClient=config=>({requestAccessToken(){config.error_callback({type:'popup_closed'});}});
      assert.equal((await initGoogleDrive('test-client')).success,false);
      assert.equal(await ensureToken('test-client'),false);assert.equal(isConnected(),false);
    });
  } finally {disconnect();globalThis.window=previousWindow;globalThis.fetch=previousFetch;}
});

test('WhatsApp share uses encoded draft text and never sends automatically',()=>{
 const previous=globalThis.window;let opened;
 try {globalThis.window={open(...args){opened=args;return null;}};
 assert.equal(sanitizeWhatsAppPhone('+91 (98765) 43210'),'919876543210');
 openWhatsAppShare('+91 (98765) 43210','Invoice ₹118 & thanks');
 const url=new URL(opened[0]);assert.equal(url.searchParams.get('text'),'Invoice ₹118 & thanks');assert.equal(url.searchParams.get('phone'),'919876543210');assert.equal(opened[2],'noopener,noreferrer');
 openWhatsAppShare(null,'Pick recipient');assert.equal(new URL(opened[0]).searchParams.has('phone'),false);
 } finally {globalThis.window=previous;}
});
