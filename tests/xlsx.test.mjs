import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {SettlementXlsx} from '../src/xlsx.ts';

function contents(book){const chunks=book.finish([['平台','全部平台']]);return unzipSync(Buffer.concat(chunks.map(c=>Buffer.from(c))))}
test('preserves identifiers, blanks, zero, cents, and untrusted strings as text',()=>{
 const book=new SettlementXlsx();book.add([{platform:'douyin',orderId:'0000999999999999999999',productId:'9999999999999999999',creatorId:'01234567890123456789',creatorAccount:'=1+1',creatorNickname:'<达人>&"\u0001',paidCents:0,settledCents:null,commissionCents:-123,serviceFeeCents:1299,closed:false}]);
 const files=contents(book),detail=strFromU8(files['xl/worksheets/sheet2.xml']);
 assert.match(detail,/0000999999999999999999/);assert.match(detail,/01234567890123456789/);
 assert.match(detail,/<c r="H2" s="0" t="inlineStr"><is><t xml:space="preserve">=1\+1/);
 assert.match(detail,/&lt;达人&gt;&amp;&quot;/);assert.ok(!detail.includes('\u0001'));
 assert.match(detail,/<c r="S2" s="2"><v>0<\/v><\/c>/);assert.ok(!detail.includes('r="T2"'));
 assert.match(detail,/<c r="V2" s="2"><v>-1.23<\/v>/);assert.match(detail,/<c r="W2" s="2"><v>12.99<\/v>/);
 assert.ok(!detail.includes('<f>'));assert.match(detail,/state="frozen"/);assert.match(detail,/autoFilter ref="A1:AF2"/);
 assert.match(strFromU8(files['xl/worksheets/sheet1.xml']),/缺失金额留空/);
});
test('writes all batches in one worksheet and validates cents',()=>{
 const book=new SettlementXlsx();for(let b=0;b<3;b++)book.add(Array.from({length:1000},(_,i)=>({platform:'kuaishou',orderId:String(900000000000000000n+BigInt(b*1000+i)),paidCents:101})));
 const detail=strFromU8(contents(book)['xl/worksheets/sheet2.xml']);
 assert.equal((detail.match(/<row /g)||[]).length,3001);assert.match(detail,/900000000000002999/);assert.match(detail,/A1:AF3001/);
 assert.throws(()=>new SettlementXlsx().add([{paidCents:1.5}]),/整数分/);
 assert.throws(()=>new SettlementXlsx().add([{paidCents:Number.MAX_SAFE_INTEGER+1}]),/整数分/);
});
