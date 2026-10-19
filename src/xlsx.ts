import {Zip,ZipDeflate,strToU8} from 'fflate';

type Value=string|number|null|undefined;
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
// Explicit inline strings prevent Excel formula execution and preserve long identifiers.
const escape=(v:string)=>v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function col(i:number){let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s}
function row(values:Value[],n:number,header=false,moneyCols:number[]=[]){return `<row r="${n}">${values.map((v,i)=>{
 if(v==null||v==='')return '';
 const ref=col(i)+n,style=header?1:moneyCols.includes(i)?2:0;
 if(typeof v==='number'){if(!Number.isFinite(v))throw Error('导出金额无效');return `<c r="${ref}" s="${style}"><v>${v}</v></c>`}
 return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escape(String(v))}</t></is></c>`;
}).join('')}</row>`}
const labels=['平台','店铺','订单归属月份','订单号','商品ID','商品名称','达人昵称','抖音号 / 快手号','达人ID','团长昵称（服务机构）','机构ID','订单创建时间','付款时间','结算时间','订单状态','结算状态','完结确认','售后状态','支付金额（元）','结算金额（元）','退款金额（元）','实际佣金（元）','服务费（元）','预估佣金（元）','预估服务费（元）','佣金率','服务费率','机构关联状态','采集时间（北京时间）','订单来源文件','结算来源文件','机构来源文件'];
const cents=['paidCents','settledCents','refundCents','commissionCents','serviceFeeCents','estimatedCommissionCents','estimatedServiceFeeCents'];
export const chinaTime=(v:string)=>v?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(v)):'';
function values(r:any):Value[]{return [r.platform==='kuaishou'?'快手':r.platform==='douyin'?'抖店':r.platform,r.shop,r.orderMonth,String(r.orderId??''),String(r.productId??''),r.productName,r.creatorNickname,String(r.creatorAccount??''),String(r.creatorId??''),r.agencyNickname,String(r.agencyId??''),r.createdAt,r.paidAt,r.settledAt,r.orderStatus,r.settlementStatus,r.closed?'已确认完结':'未确认完结',r.afterSale,...cents.map(k=>{if(r[k]==null)return null;if(!Number.isSafeInteger(r[k]))throw Error('金额不是安全整数分，请联系管理员');return r[k]/100}),r.commissionRate,r.serviceRate,r.agencyMatch,chinaTime(r.capturedAt),r.source,r.billSource,r.agencySource]}

/** Streaming OOXML keeps memory proportional to compressed output, rather than cell objects. */
export class SettlementXlsx{
 private chunks:Uint8Array[]=[];private zip:Zip;private detail:ZipDeflate;private count=0;private done=false;
 constructor(){
  this.zip=new Zip((err,chunk)=>{if(err)throw err;this.chunks.push(chunk)});
  this.file('[Content_Types].xml',xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  this.file('_rels/.rels',xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  this.file('xl/workbook.xml',xml+`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="导出说明" sheetId="1" r:id="rId1"/><sheet name="结算明细" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  this.file('xl/_rels/workbook.xml.rels',xml+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  this.file('xl/styles.xml',xml+'<styleSheet xmlns="'+ns+'"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;[Red](#,##0.00);0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF197C68"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  this.detail=new ZipDeflate('xl/worksheets/sheet2.xml',{level:3});this.zip.add(this.detail);
  const widths=labels.map((_,i)=>[1,5,9,29,30,31].includes(i)?36:[3,4,7,8,10,11,12,13,28].includes(i)?24:20);
  this.detail.push(strToU8(xml+`<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>`+row(labels,1,true)));
 }
 private file(name:string,contents:string){const f=new ZipDeflate(name,{level:3});this.zip.add(f);f.push(strToU8(contents),true)}
 add(records:any[]){if(this.done)throw Error('导出已结束');if(this.count+records.length>1048575)throw Error('超过 Excel 行数上限，请缩小筛选范围');this.detail.push(strToU8(records.map(r=>row(values(r),++this.count+1,false,[18,19,20,21,22,23,24])).join('')))}
 finish(info:Value[][]){if(this.done)throw Error('导出已结束');this.done=true;this.detail.push(strToU8(`</sheetData><autoFilter ref="A1:AF${this.count+1}"/></worksheet>`),true);
  this.file('xl/worksheets/sheet1.xml',xml+`<worksheet xmlns="${ns}"><cols><col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="100" customWidth="1"/></cols><sheetData>`+[['结算对账导出','筛选范围与数据口径'],...info,['明细行数',this.count],['金额说明','单位：人民币元。缺失金额留空，已知零金额保留 0.00。'],['月份口径','快手按下单时间，抖店按付款时间归属月份。'],['完结口径','未确认完结表示平台尚未明确最终状态，不能直接视为漏结算。'],['来源','https://songyunjie1994.github.io/settlement-reconciliation/']].map((v,i)=>row(v,i+1,i===0)).join('')+'</sheetData></worksheet>');
  this.zip.end();return this.chunks.map(c=>c.slice().buffer as ArrayBuffer);
 }
}
