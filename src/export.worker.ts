import {SettlementXlsx} from './xlsx';
let book:SettlementXlsx;
self.onmessage=({data})=>{try{if(data.kind==='start')book=new SettlementXlsx();else if(data.kind==='rows')book.add(data.rows);else if(data.kind==='finish'){const chunks=book.finish(data.info);self.postMessage({chunks},{transfer:chunks});return}self.postMessage({ok:true})}catch(e){self.postMessage({error:e instanceof Error?e.message:'Excel 生成失败'})}};
