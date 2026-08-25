import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm';
import { fetchFile, toBlobURL } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/+esm';

const $=id=>document.getElementById(id),fileInput=$('file'),drop=$('drop'),info=$('info'),previewCard=$('previewCard'),preview=$('preview'),actions=$('actions'),processButton=$('process'),clearButton=$('clear'),download=$('download'),progressWrap=$('progressWrap'),progressBar=$('progress'),status=$('status');
let ffmpeg=null,loading=null,ready=false,selectedFile=null,sourceUrl=null,outputUrl=null,processing=false,meta={width:0,height:0,duration:0};
let sourceVideo=false,sourceAudio=false;

function setText(id,value){const n=$(id);if(n)n.textContent=value}
function show(n){n?.classList.remove('hidden')}
function hide(n){n?.classList.add('hidden')}
function setProgress(percent,title='Preparing'){const p=Math.max(0,Math.min(100,Math.round(Number(percent)||0)));show(progressWrap);if(progressBar)progressBar.style.width=p+'%';setText('progressPercent',p+'%');setText('progressTitle',title)}
function step(n){[1,2,3].forEach(i=>{const e=$('step'+i);if(e){e.classList.toggle('active',i===n);e.classList.toggle('done',i<n)}})}
function bytes(n){if(n<1024)return n+' B';if(n<1048576)return(n/1024).toFixed(1)+' KB';return(n/1048576).toFixed(1)+' MB'}
function duration(n){if(!Number.isFinite(n))return'—';const s=Math.round(n);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
function resolution(v){if(!v||v==='source')return null;const[w,h]=v.split(':').map(Number);return Number.isFinite(w)&&Number.isFinite(h)?{w,h}:null}

let logPanel=null;
function addLog(message,type='info'){
  if(!logPanel){
    logPanel=document.createElement('div');
    logPanel.id='liveLog';
    Object.assign(logPanel.style,{marginTop:'12px',background:'#050505',border:'1px solid #252525',borderRadius:'12px',padding:'10px',font:'12px ui-monospace,SFMono-Regular,Menlo,monospace',color:'#aaa',maxHeight:'220px',overflowY:'auto',whiteSpace:'pre-wrap',wordBreak:'break-word'});
    const title=document.createElement('div');title.textContent='LIVE LOG';Object.assign(title.style,{color:'#fff',fontWeight:'700',marginBottom:'8px',letterSpacing:'.08em'});logPanel.appendChild(title);
    (progressWrap?.parentElement||document.body).appendChild(logPanel);
  }
  const line=document.createElement('div');
  line.textContent=`[${new Date().toLocaleTimeString()}] ${message}`;
  line.style.color=type==='error'?'#ff6b6b':type==='ok'?'#8cffb0':'#aaa';
  logPanel.appendChild(line);logPanel.scrollTop=logPanel.scrollHeight;
}

function livePreview(){
 if(!sourceVideo||!preview)return;
 const b=Number($('brightness')?.value??0),c=Number($('contrast')?.value??1),rot=$('rotation')?.value||'0',mir=$('mirror')?.value||'none',fps=$('fps')?.value||'source',res=resolution($('resolution')?.value),wm=$('watermarkPreset')?.value||'none',size=Number($('watermarkSize')?.value||12);
 preview.style.filter=`brightness(${Math.max(0,1+b)}) contrast(${Math.max(0,c)})`;
 const t=[];if(rot==='90')t.push('rotate(90deg)');if(rot==='180')t.push('rotate(180deg)');if(rot==='270')t.push('rotate(270deg)');if(mir==='horizontal')t.push('scaleX(-1)');if(mir==='vertical')t.push('scaleY(-1)');preview.style.transform=t.join(' ')||'none';
 if(res){previewCard.style.aspectRatio=res.w+'/'+res.h;preview.style.width='100%';preview.style.height='100%';preview.style.objectFit='contain'}else{previewCard.style.aspectRatio='';preview.style.width='100%';preview.style.height='auto'}
 let badge=$('liveBadge');if(!badge){badge=document.createElement('div');badge.id='liveBadge';Object.assign(badge.style,{position:'absolute',top:'12px',left:'12px',zIndex:5,padding:'7px 10px',borderRadius:'99px',background:'rgba(0,0,0,.75)',color:'#fff',font:'600 11px system-ui',pointerEvents:'none'});previewCard.style.position='relative';previewCard.appendChild(badge)}
 badge.textContent=`LIVE · ${res?res.w+'×'+res.h:meta.width+'×'+meta.height} · ${fps==='source'?'Source FPS':fps+' FPS'}`;
 let box=$('watermarkPreview');if(!box){box=document.createElement('div');box.id='watermarkPreview';Object.assign(box.style,{position:'absolute',display:'none',zIndex:4,pointerEvents:'none',background:'rgba(0,0,0,.3)',backdropFilter:'blur(14px)',WebkitBackdropFilter:'blur(14px)',border:'1px solid rgba(255,255,255,.2)',borderRadius:'8px'});previewCard.appendChild(box)}
 if(wm==='none'){box.style.display='none';return}box.style.display='block';box.style.width=Math.min(40,Math.max(7,size*1.8))+'%';box.style.height=Math.min(32,Math.max(6,size*1.15))+'%';box.style.left=wm.includes('left')?'2%':wm.includes('right')?'auto':'50%';box.style.right=wm.includes('right')?'2%':'auto';box.style.top=wm.includes('top')?'2%':wm.includes('bottom')?'auto':'50%';box.style.bottom=wm.includes('bottom')?'2%':'auto';box.style.transform=wm==='center'?'translate(-50%,-50%)':'none';
}

async function metadata(file){const u=URL.createObjectURL(file),m=document.createElement(file.type.startsWith('audio/')?'audio':'video');m.preload='metadata';m.src=u;return new Promise((resolve,reject)=>{m.onloadedmetadata=()=>{const r={duration:m.duration,width:m.videoWidth||0,height:m.videoHeight||0};URL.revokeObjectURL(u);resolve(r)};m.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('Could not read this media file.'))}})}

function filters(){const f=[],res=resolution($('resolution')?.value),fps=$('fps')?.value||'source',b=Number($('brightness')?.value??0),c=Number($('contrast')?.value??1),rot=$('rotation')?.value||'0',mir=$('mirror')?.value||'none',wm=$('watermarkPreset')?.value||'none',size=Number($('watermarkSize')?.value||12)/100;
 if(res)f.push(`scale=${res.w}:${res.h}:force_original_aspect_ratio=decrease,pad=${res.w}:${res.h}:(ow-iw)/2:(oh-ih)/2`);if(fps!=='source')f.push('fps='+fps);if(b!==0||c!==1)f.push(`eq=brightness=${Math.max(-1,Math.min(1,b))}:contrast=${Math.max(0,Math.min(3,c))}`);if(mir==='horizontal')f.push('hflip');if(mir==='vertical')f.push('vflip');if(rot==='90')f.push('transpose=1');if(rot==='180')f.push('transpose=2,transpose=2');if(rot==='270')f.push('transpose=2');
 if(wm!=='none'&&meta.width&&meta.height){const w=Math.max(12,Math.round(meta.width*size)),h=Math.max(12,Math.round(meta.height*size*.65)),mx=Math.round(meta.width*.02),my=Math.round(meta.height*.02);let x=(meta.width-w)/2,y=(meta.height-h)/2;if(wm.includes('left'))x=mx;if(wm.includes('right'))x=meta.width-w-mx;if(wm.includes('top'))y=my;if(wm.includes('bottom'))y=meta.height-h-my;f.push(`delogo=x=${Math.max(0,Math.round(x))}:y=${Math.max(0,Math.round(y))}:w=${w}:h=${h}:show=0`)}return f.join(',')}

async function ensureFFmpeg(){
 if(ready)return;
 if(loading)return loading;
 loading=(async()=>{
   step(1);setProgress(8,'Loading encoder');setText('status','Loading FFmpeg engine…');addLog('Creating FFmpeg instance');
   const x=new FFmpeg();
   x.on('log',({message})=>{if(message){addLog(message);console.debug('[FFmpeg]',message)}});
   addLog('FFmpeg log listener attached');
   const base='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
   addLog('Preparing core JavaScript: '+base+'/ffmpeg-core.js');
   let core,wasm;
   try{core=await toBlobURL(base+'/ffmpeg-core.js','text/javascript');addLog('Core JavaScript downloaded');}catch(e){addLog('Core JavaScript download failed: '+(e?.message||e),'error');throw e}
   try{addLog('Downloading WebAssembly core (~31 MB)…');wasm=await toBlobURL(base+'/ffmpeg-core.wasm','application/wasm');addLog('WebAssembly core downloaded');}catch(e){addLog('WebAssembly download failed: '+(e?.message||e),'error');throw e}
   addLog('Calling ffmpeg.load() — waiting for WebAssembly worker to initialize');
   setText('status','Starting FFmpeg WebAssembly…');
   const loadedResult=await x.load({coreURL:core,wasmURL:wasm});
   addLog('ffmpeg.load() resolved: '+String(loadedResult),'ok');
   ffmpeg=x;ready=true;setProgress(12,'Encoder ready');setText('status','Encoder ready. Processing…');addLog('Encoder ready','ok');
 })();
 try{await loading}catch(e){ffmpeg=null;ready=false;addLog('FFmpeg initialization failed: '+(e?.message||e),'error');throw e}finally{loading=null}
}

async function processFile(){if(!selectedFile||processing)return;processing=true;hide(download);if(processButton)processButton.disabled=true;try{await ensureFFmpeg();step(2);setProgress(15,'Preparing input');addLog('Writing input file to FFmpeg virtual filesystem');const ext=selectedFile.name.split('.').pop()?.toLowerCase()||'mp4',input='input_'+Date.now()+'.'+ext,output=sourceAudio?'output_'+Date.now()+'.mp3':'output_'+Date.now()+'.mp4';await ffmpeg.writeFile(input,await fetchFile(selectedFile));addLog('Input written: '+bytes(selectedFile.size));let args;if(sourceAudio){args=['-i',input,'-vn','-c:a','libmp3lame','-b:a',$('bitrate')?.value||'192k','-y',output]}else{args=['-i',input];const vf=filters();if(vf)args.push('-vf',vf);args.push('-c:v','libx264','-preset','veryfast','-crf',$('quality')?.value||'22','-pix_fmt','yuv420p');if(($('audioMode')?.value||'keep')==='mute')args.push('-an');else args.push('-c:a','aac','-b:a','192k');args.push('-movflags','+faststart','-y',output)}addLog('FFmpeg command: '+args.join(' '));await ffmpeg.exec(args);addLog('FFmpeg command completed','ok');step(3);setProgress(96,'Finishing');const data=await ffmpeg.readFile(output);addLog('Output read: '+bytes(data.byteLength??data.length));if(outputUrl)URL.revokeObjectURL(outputUrl);outputUrl=URL.createObjectURL(new Blob([data.buffer],{type:sourceAudio?'audio/mpeg':'video/mp4'}));download.href=outputUrl;download.download=output;download.textContent='Download modified '+(sourceAudio?'MP3':'MP4');show(download);setProgress(100,'Finished');setText('status','Done — your selected changes were encoded into the output.');addLog('Output ready for download','ok')}catch(e){console.error(e);setProgress(0,'Error');setText('status',e instanceof Error?e.message:'Processing failed.');addLog('PROCESSING ERROR: '+(e?.message||e),'error')}finally{processing=false;if(processButton)processButton.disabled=false}}

async function loadFile(file){if(!file||processing)return;selectedFile=file;sourceVideo=file.type.startsWith('video/')||/\.(mp4|mov|webm|mkv)$/i.test(file.name);sourceAudio=file.type.startsWith('audio/')||/\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name);try{step(1);setProgress(2,'Checking file');addLog('Selected '+file.name+' ('+bytes(file.size)+')');meta=await metadata(file);setProgress(7,'File ready');setText('name',file.name);setText('size',bytes(file.size));setText('duration',duration(meta.duration));setText('type',sourceVideo?'VIDEO':'AUDIO');setText('video',sourceVideo?meta.width+' × '+meta.height:'None');setText('audio',sourceVideo||sourceAudio?'Available':'None');show(info);show(actions);if(sourceUrl)URL.revokeObjectURL(sourceUrl);sourceUrl=URL.createObjectURL(file);if(sourceVideo){preview.src=sourceUrl;show(previewCard);livePreview()}else{hide(previewCard)}setText('status','File checked. Starting automatic processing…');addLog('Metadata read successfully','ok');await processFile()}catch(e){console.error(e);setProgress(0,'Error');setText('status',e instanceof Error?e.message:'Could not read the file.');addLog('FILE ERROR: '+(e?.message||e),'error')}}

function reset(){if(sourceUrl)URL.revokeObjectURL(sourceUrl);if(outputUrl)URL.revokeObjectURL(outputUrl);sourceUrl=outputUrl=null;selectedFile=null;sourceVideo=sourceAudio=false;if(fileInput)fileInput.value='';if(preview){preview.pause();preview.removeAttribute('src');preview.load();preview.style.filter='none';preview.style.transform='none'}hide(info);hide(previewCard);hide(actions);hide(progressWrap);hide(download);if(logPanel){logPanel.remove();logPanel=null}setText('status','Set your options, then choose a file.')}

fileInput?.addEventListener('change',e=>loadFile(e.target.files?.[0]));drop?.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragging')});drop?.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop?.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragging');loadFile(e.dataTransfer?.files?.[0])});processButton?.addEventListener('click',processFile);clearButton?.addEventListener('click',reset);
['fps','resolution','quality','audioMode','rotation','mirror','brightness','contrast','watermarkPreset','watermarkSize','bitrate'].forEach(id=>{const n=$(id);n?.addEventListener('input',livePreview);n?.addEventListener('change',livePreview)});
livePreview();