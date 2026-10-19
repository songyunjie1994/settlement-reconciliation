import {exportPage} from './api';
import {chinaTime} from './xlsx';

export async function downloadExcel(params:URLSearchParams,onProgress:(message:string)=>void,signal:AbortSignal){
 const worker=new Worker(new URL('./export.worker.ts',import.meta.url),{type:'module'});
 const call=(message:unknown)=>new Promise<any>((resolve,reject)=>{
  const aborted=()=>{cleanup();reject(new DOMException('已取消导出','AbortError'))};
  const cleanup=()=>signal.removeEventListener('abort',aborted);
  worker.onmessage=e=>{cleanup();e.data.error?reject(Error(e.data.error)):resolve(e.data)};
  worker.onerror=()=>{cleanup();reject(Error('Excel 生成失败，请重试'))};
  if(signal.aborted)return aborted();signal.addEventListener('abort',aborted,{once:true});worker.postMessage(message);
 });
 try{
  onProgress('正在读取导出范围…');let batch=await exportPage(params,'',null,false,signal);
  const expected=Number(batch.records),revision=batch.revision,asOf=batch.asOf;
  if(!Number.isSafeInteger(expected)||expected<0||typeof revision!=='string'||!asOf)throw Error('导出范围读取失败，请重试');
  if(!expected)throw Error('当前筛选没有可导出的明细');
  await call({kind:'start'});let count=0;let previous='';
  while(true){
   if(!Array.isArray(batch.rows)||!batch.rows.length&&batch.nextCursor)throw Error('导出分页不完整，请重试');
   count+=batch.rows.length;if(count>expected)throw Error('采集数据已更新，请重新导出');
   await call({kind:'rows',rows:batch.rows});onProgress(`正在导出 ${count.toLocaleString()} / ${expected.toLocaleString()} 条`);
   if(!batch.nextCursor)break;
   if(batch.nextCursor===previous)throw Error('导出分页异常，请重试');previous=batch.nextCursor;
   batch=await exportPage(params,previous,asOf,false,signal);
  }
  onProgress('正在核验导出完整性…');const check=await exportPage(params,'',asOf,true,signal);
  if(count!==expected||Number(check.records)!==expected||check.revision!==revision)throw Error('导出期间采集数据发生变化，请重新导出');
  onProgress('正在生成 Excel…');
  const p=params.get('platform'),label=p==='douyin'?'抖店':p==='kuaishou'?'快手':'全部平台';
  const {chunks}=await call({kind:'finish',info:[['导出时间（北京时间）',chinaTime(asOf)],['平台',label],['店铺',params.get('shop')||'全部店铺'],['订单归属月份',params.get('month')||'全部月份'],['完结筛选',params.get('open')==='1'?'仅未确认完结':'全部'],['搜索条件',params.get('q')||'无'],['数据范围','当前筛选下全部匹配明细；不是当前页。']]});
  signal.throwIfAborted();
  const url=URL.createObjectURL(new Blob(chunks,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const a=document.createElement('a');a.href=url;a.download=`结算对账_${label}_${params.get('month')||'全部月份'}_${chinaTime(asOf).replace(/[-: ]/g,'')}.xlsx`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  return count;
 }finally{worker.terminate()}
}
