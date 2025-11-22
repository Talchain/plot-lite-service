#!/usr/bin/env node
import { mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { sha256File } from './lib/sha256.mjs';
import { zipDirToBuffer } from './lib/zip.mjs';

function usage(){ console.log('usage: node tools/unified-pack.mjs [--ui ui.zip|dir] [--engine engine.zip|dir] [--claude claude.zip|dir] --out evidence/unified [--map comp.path=dest_slo]... [--print]'); }
function args(){ const a=process.argv; const out={ui:null,engine:null,claude:null,out:null,print:false,maps:[]}; for(let i=2;i<a.length;i++){const t=a[i]; if(t==='--ui') out.ui=a[++i]||null; else if(t==='--engine') out.engine=a[++i]||null; else if(t==='--claude') out.claude=a[++i]||null; else if(t==='--out') out.out=a[++i]||null; else if(t==='--map'){ const mv=a[++i]||''; if(mv) out.maps.push(mv);} else if(t==='--print') out.print=true; else if(t==='--help'||t==='-h'){usage(); process.exit(0);} } return out; }
const isZip=p=>{try{return extname(p).toLowerCase()==='.zip'&&statSync(p).isFile();}catch{return false;}}; const isDir=p=>{try{return statSync(p).isDirectory();}catch{return false;}};
function findZips(dir){const out=[]; function walk(d,depth=0){ if(depth>4) return; let ents=[]; try{ents=readdirSync(d,{withFileTypes:true});}catch{return;} for(const e of ents){const p=join(d,e.name); if(e.isDirectory()) walk(p,depth+1); else if(e.isFile()&&extname(e.name).toLowerCase()==='.zip') out.push(p);} } walk(dir); out.sort(); return out.slice(-3);} 
function discover(kind){const c=[]; if(kind==='ui'){c.push(...findZips(resolve('evidence/ui'))); c.push(...findZips(resolve('..','ui')));} else if(kind==='engine'){c.push(...findZips(resolve('artifact'))); try{const ds=readdirSync('artifact',{withFileTypes:true}).filter(d=>d.isDirectory()&&/^Evidence-Pack-\d{8}-\d{4}$/.test(d.name)).map(d=>join('artifact',d.name)).sort(); if(ds.length) c.push(ds[ds.length-1]);}catch{}} else if(kind==='claude'){c.push(...findZips(resolve('evidence/claude'))); c.push(...findZips(resolve('..','claude')));} return c.length?c[c.length-1]:null;}
function readJsonSafe(p){ try{ return JSON.parse(readFileSync(p,'utf8')); }catch{ return null; } }
function readFromZip(zp, rels){ const z=new AdmZip(zp); const es=z.getEntries(); for(const r of rels){ const e=es.find(en=>en.entryName===r||en.entryName.endsWith('/'+r)); if(e){ try{ return JSON.parse(e.getData().toString('utf8')); }catch{ return null; } } } return null; }
const hashBuf=b=>{const h=createHash('sha256'); h.update(b); return h.digest('hex');};
function slo(uiM, engM, engSum, engLc, claM){ const o={ ui_layout_p95_ms:null, engine_get_p95_ms:null, claude_ttff_ms:null, claude_cancel_ms:null }; if(uiM&&typeof uiM.ui_layout_p95_ms==='number') o.ui_layout_p95_ms=uiM.ui_layout_p95_ms; if(engM&&typeof engM.engine_get_p95_ms==='number') o.engine_get_p95_ms=engM.engine_get_p95_ms; if(o.engine_get_p95_ms==null){ if(engSum&&typeof engSum.p95_ms==='number') o.engine_get_p95_ms=engSum.p95_ms; else if(engLc&&typeof engLc.p95_ms==='number') o.engine_get_p95_ms=engLc.p95_ms; } if(claM){ if(typeof claM.claude_ttff_ms==='number') o.claude_ttff_ms=claM.claude_ttff_ms; if(typeof claM.claude_cancel_ms==='number') o.claude_cancel_ms=claM.claude_cancel_ms; } return o; }

function getByPath(obj, parts){ try{ let cur=obj; for(const p of parts){ if(cur==null) return undefined; cur=cur[p]; } return cur; } catch { return undefined; } }

async function main(){
  const a=args(); if(!a.out){ console.error('unified-pack: --out <dir> is required'); usage(); process.exit(2);} const OUT_DIR=resolve(a.out); mkdirSync(OUT_DIR,{recursive:true});
  const ins={ ui:a.ui||discover('ui'), engine:a.engine||discover('engine'), claude:a.claude||discover('claude') };
  const comps={};
  for(const k of ['ui','engine','claude']){
    const p=ins[k]; if(!p){ comps[k]={kind:null,path:null,manifest:null,packSummary:null,loadcheck:null,zipName:`${k}.zip`,zipBuffer:null,checksum:null}; continue; }
    const abs=resolve(p); const kind=isZip(abs)?'zip':(isDir(abs)?'dir':null);
    let manifest=null, packSummary=null, loadcheck=null, zipBuffer=null, checksum=null, zipName=`${k}.zip`;
    if(kind==='zip'){
      manifest=readFromZip(abs,['manifest.json']); if(k==='engine'){ packSummary=readFromZip(abs,['pack-summary.json']); loadcheck=readFromZip(abs,['reports/loadcheck.json']); }
      checksum=await sha256File(abs); zipName=basename(abs);
    } else if(kind==='dir'){
      manifest=readJsonSafe(join(abs,'manifest.json')); if(k==='engine'){ packSummary=readJsonSafe(join(abs,'pack-summary.json')); loadcheck=readJsonSafe(join(abs,'reports','loadcheck.json')); }
      try{ zipBuffer=zipDirToBuffer(abs); checksum=hashBuf(zipBuffer); }catch{}
      zipName=basename(abs)+'.zip';
    }
    comps[k]={kind,path:abs,manifest,packSummary,loadcheck,zipName,zipBuffer,checksum};
  }
  const uis=comps.ui?.manifest||null, engm=comps.engine?.manifest||null, engsum=comps.engine?.packSummary||null, engl= comps.engine?.loadcheck||null, clm=comps.claude?.manifest||null;
  const man={
    ui: uis, engine: engm, claude: clm,
    contracts: { sse_events: 7, report_schema: 'report.v1', health_keys: ['status','p95_ms','replay','test_routes_enabled'] },
    slos: slo(uis, engm, engsum, engl, clm),
    checksums: [comps.ui?.checksum, comps.engine?.checksum, comps.claude?.checksum].filter(Boolean)
  };

  // Optional SLO remapping overrides via --map comp.path=dest_slo
  try {
    const allowed = new Set(['ui_layout_p95_ms','engine_get_p95_ms','claude_ttff_ms','claude_cancel_ms']);
    for (const m of (a.maps||[])){
      const eq = String(m||''); const idx = eq.indexOf('=');
      if (idx <= 0) continue;
      const left = eq.slice(0, idx).trim();
      const dest = eq.slice(idx+1).trim();
      if (!allowed.has(dest)) continue;
      const leftParts = left.split('.').filter(Boolean);
      const comp = leftParts.shift();
      if (!comp || !['ui','engine','claude'].includes(comp)) continue;
      const src = getByPath(comps?.[comp]?.manifest || {}, leftParts);
      if (typeof src === 'number' && Number.isFinite(src)) {
        man.slos[dest] = src;
      }
    }
  } catch {}
  // validate
  try{
    const schema=JSON.parse(readFileSync(resolve('contracts','unified-manifest.schema.json'),'utf8'));
    const ajv=new Ajv({allErrors:true, strict:false});
    const validate=ajv.compile(schema); if(!validate(man)) { console.error('unified-pack: schema invalid', validate.errors); process.exit(1);} }
  catch(e){ console.error('unified-pack: schema validation error', e?.message||e); process.exit(1); }

  // write manifest.json to temp dir and embed inputs into a unified zip
  const stamp=nowStamp(); const outDir=OUT_DIR; mkdirSync(outDir,{recursive:true});
  const manifestPath=join(outDir,'manifest.json'); writeFileSync(manifestPath, JSON.stringify(man, null, 2));
  const zipName=`Olumi_PoC_Evidence_${stamp}.zip`; const zipPath=join(outDir, zipName);
  const zip=new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(man,null,2)));
  zip.addFile('INDEX.md', Buffer.from(`# Unified Evidence\n\nSLOs: ${JSON.stringify(man.slos)}\n`));
  for(const k of ['ui','engine','claude']){
    const c=comps[k]; if(!c||!c.kind) continue;
    if(c.kind==='zip') zip.addLocalFile(c.path, '', `${k}/${basename(c.path)}`);
    else if(c.kind==='dir' && c.zipBuffer) zip.addFile(`${k}/${basename(c.path)}.zip`, c.zipBuffer);
  }
  writeFileSync(zipPath, zip.toBuffer());

  if(a.print){ const compsN=['ui','engine','claude'].filter(k=>comps[k]?.kind).length; console.log(`UNIFIED: OK path=${zipPath} components=${compsN} slos=${JSON.stringify({engine:man.slos.engine_get_p95_ms,ui:man.slos.ui_layout_p95_ms,claude:man.slos.claude_ttff_ms})}`); }
}

function nowStamp(){ const d=new Date(); const pad=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`; }

main().catch(e=>{ console.error(e?.message||e); process.exit(1); });
