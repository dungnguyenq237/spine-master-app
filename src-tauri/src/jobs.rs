use std::{collections::HashMap,path::PathBuf,sync::{Arc,Mutex,atomic::{AtomicBool,AtomicU8,Ordering}},process::Stdio};
use serde::{Deserialize,Serialize};
use tauri::{AppHandle,Emitter,State,ipc::{Request,InvokeBody}};
use tokio::{io::{AsyncWriteExt,AsyncBufReadExt,BufReader},process::{Child,ChildStdin,Command},sync::{Mutex as AsyncMutex,Notify}};
use uuid::Uuid;
use crate::{assets::AssetAccess,encoders::{self,EncoderConfig}};
#[derive(Clone,Deserialize,Serialize)] #[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Settings {pub format:String,pub width:u32,pub height:u32,pub fps:f64,pub frames:u32,pub quality:String,pub transparent:bool,pub columns:u32,pub sheet_padding:u32,pub dither:String,pub palette_colors:u32,pub alpha_threshold:u32,pub gif_repeat:i32,pub name:String,pub destination:String}
impl Settings {
    fn validate(&self)->Result<(),String>{
        if !["mp4","gif","png","sheet","prores","webm"].contains(&self.format.as_str()) || !["fast","balanced","high","maximum"].contains(&self.quality.as_str()){return Err("Invalid output format/preset".into());}
        if self.width<2||self.height<2||self.width>8192||self.height>8192||u64::from(self.width)*u64::from(self.height)>32*1024*1024 {return Err("Invalid output dimensions (32 megapixel limit)".into());}
        if !self.fps.is_finite()||self.fps<1.0||self.fps>120.0||self.frames==0||self.frames>1_000_000{return Err("Invalid frame schedule".into());}
        if self.format=="mp4"&&(self.transparent||self.width%2!=0||self.height%2!=0){return Err("H.264 requires opaque, even dimensions".into());}
        if self.format=="webm"&&(self.width%2!=0||self.height%2!=0){return Err("VP9 4:2:0 requires even dimensions".into());}
        if self.columns==0||self.columns>32||self.sheet_padding>64||self.palette_colors<4||self.palette_colors>256||self.alpha_threshold>255||!(-1..=65535).contains(&self.gif_repeat)||!["sierra2_4a","bayer","none"].contains(&self.dither.as_str()){return Err("Invalid image/GIF settings".into());}
        if self.format == "sheet" { sheet_layout(self)?; }
        Ok(())
    }
}
#[derive(Clone,Serialize)] pub struct Progress {id:String,stage:String,frame:u32,total:u32,message:String}
#[derive(Serialize)] pub struct ExportResult {output:String,verification:String}
pub struct Inner {child:Option<Child>,stdin:Option<ChildStdin>,frames:u32,sheet:Option<image::RgbaImage>,sheet_page:u32,sheet_used:u32,first_has_alpha:bool,stderr:Arc<Mutex<String>>}
pub struct Job {pub id:String,settings:Settings,staging:PathBuf,destination:PathBuf,ffmpeg:Option<PathBuf>,ffprobe:Option<PathBuf>,inner:AsyncMutex<Inner>,lifecycle:AtomicU8,notify:Notify,finishing:AtomicBool,pub output:Mutex<Option<PathBuf>>}
#[derive(Default)] pub struct Jobs {pub jobs:Mutex<HashMap<String,Arc<Job>>>}
impl Jobs {pub fn get(&self,id:&str)->Result<Arc<Job>,String>{self.jobs.lock().map_err(|e|e.to_string())?.get(id).cloned().ok_or("Unknown export job".into())}}
fn progress(app:&AppHandle,j:&Job,stage:&str,frame:u32,message:&str){let _=app.emit("export-progress",Progress{id:j.id.clone(),stage:stage.into(),frame,total:j.settings.frames,message:message.into()});}
const ACTIVE: u8 = 0;
const CANCELLED: u8 = 1;
const COMMITTING: u8 = 2;
const COMPLETED: u8 = 3;
const FAILED: u8 = 4;
fn cancelled(j: &Job) -> Result<(), String> {
    if matches!(j.lifecycle.load(Ordering::SeqCst), CANCELLED | FAILED) {
        Err("Export cancelled".into())
    } else { Ok(()) }
}
fn request_cancel(j: &Job) -> bool {
    match j.lifecycle.compare_exchange(ACTIVE, CANCELLED, Ordering::SeqCst, Ordering::SeqCst) {
        Ok(_) | Err(CANCELLED) | Err(FAILED) => {
            j.notify.notify_waiters();
            j.notify.notify_one();
            true
        }
        _ => false, // Publication has already claimed this job.
    }
}
async fn release_buffers(inner: &mut Inner) {
    inner.stdin.take();
    inner.sheet.take();
    inner.sheet_used = 0;
    if let Some(mut child) = inner.child.take() { let _ = child.kill().await; }
    if let Ok(mut stderr) = inner.stderr.lock() { stderr.clear(); }
}
async fn cleanup(j: &Job) {
    let mut inner = j.inner.lock().await;
    release_buffers(&mut inner).await;
    let _ = tokio::fs::remove_dir_all(&j.staging).await;
}
fn filename(name:&str)->String {let clean:String=name.chars().map(|c|if c.is_ascii_alphanumeric()||c=='-'||c=='_'{c}else{'_'}).take(100).collect();if clean.is_empty(){"animation".into()}else{clean}}
fn ext(format:&str)->&str{match format{"mp4"=>"mp4","gif"=>"gif","webm"=>"webm","prores"=>"mov",_=>""}}
fn drain(child:&mut Child,app:AppHandle,id:String,total:u32,stderr:Arc<Mutex<String>>){
    if let Some(err)=child.stderr.take(){tauri::async_runtime::spawn(async move{let mut lines=BufReader::new(err).lines();while let Ok(Some(line))=lines.next_line().await{if let Ok(mut text)=stderr.lock(){text.push_str(&line);text.push('\n');if text.len()>8192{let cut=text.char_indices().map(|(i,_)|i).find(|i|*i>=text.len()-8192).unwrap_or(0);text.drain(..cut);}}}});}
    if let Some(out)=child.stdout.take(){tauri::async_runtime::spawn(async move{let mut lines=BufReader::new(out).lines();while let Ok(Some(line))=lines.next_line().await{if let Some(n)=line.strip_prefix("frame=").and_then(|s|s.trim().parse::<u32>().ok()){let _=app.emit("export-progress",Progress{id:id.clone(),stage:"encoding".into(),frame:n,total,message:String::new()});}}});}
}
#[tauri::command]
pub async fn start_export(app:AppHandle,settings:Settings,access:State<'_,AssetAccess>,config:State<'_,EncoderConfig>,jobs:State<'_,Jobs>)->Result<String,String>{
    settings.validate()?;
    let destination=access.destinations.lock().map_err(|e|e.to_string())?.get(&settings.destination).cloned().ok_or("Choose an output directory first")?;
    let destination=destination.canonicalize().map_err(|e|e.to_string())?;
    let pair=if ["png","sheet"].contains(&settings.format.as_str()){None}else{Some(encoders::ensure(&config,&settings).await?)};
    let id=Uuid::new_v4().to_string();let staging=destination.join(format!(".spine-export-{id}"));tokio::fs::create_dir(&staging).await.map_err(|e|e.to_string())?;
    let stderr=Arc::new(Mutex::new(String::new()));let mut child=None;let mut stdin=None;
    if let Some((ffmpeg,_))=&pair{
        let output=staging.join(if settings.format=="gif"{"intermediate.mkv"}else{"output.tmp"});
        let mut args=encoders::input_args(&settings);args.extend(encoders::output_args(&settings));
        args.extend(["-f".into(),if settings.format=="gif"{"matroska"}else if settings.format=="prores"{"mov"}else{ext(&settings.format)}.into(),output.to_string_lossy().into_owned()]);
        match Command::new(ffmpeg).args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true).spawn(){
            Ok(mut process)=>{stdin=process.stdin.take();drain(&mut process,app.clone(),id.clone(),settings.frames,stderr.clone());child=Some(process);},
            Err(e)=>{let _=tokio::fs::remove_dir_all(&staging).await;return Err(e.to_string());}
        }
    }
    let j=Arc::new(Job{id:id.clone(),settings,staging,destination,ffmpeg:pair.as_ref().map(|p|p.0.clone()),ffprobe:pair.map(|p|p.1),inner:AsyncMutex::new(Inner{child,stdin,frames:0,sheet:None,sheet_page:0,sheet_used:0,first_has_alpha:false,stderr}),lifecycle:AtomicU8::new(ACTIVE),notify:Notify::new(),finishing:AtomicBool::new(false),output:Mutex::new(None)});
    let inserted={
        let mut map=jobs.jobs.lock().map_err(|e|e.to_string())?;
        let active=map.values().any(|v|matches!(v.lifecycle.load(Ordering::SeqCst), ACTIVE | COMMITTING));
        if active {false} else {map.insert(id.clone(),j.clone());true}
    };
    if !inserted {
        let mut inner=j.inner.lock().await;if let Some(c)=inner.child.as_mut(){let _=c.kill().await;}
        let _=tokio::fs::remove_dir_all(&j.staging).await;return Err("An export is already active".into());
    }
    Ok(id)
}
fn sheet_layout(s: &Settings) -> Result<(u32, u32, u32, u32), String> {
    const PIXEL_BUDGET: u64 = 32 * 1024 * 1024;
    let cell_w = u64::from(s.width) + 2 * u64::from(s.sheet_padding);
    let cell_h = u64::from(s.height) + 2 * u64::from(s.sheet_padding);
    if cell_w == 0 || cell_h == 0 || cell_w > 8192 || cell_h > 8192 {
        return Err("Sprite cell exceeds dimension limits".into());
    }
    let cell_pixels = cell_w * cell_h;
    let cols = u64::from(s.columns).min(8192 / cell_w).min(PIXEL_BUDGET / cell_pixels);
    if cols == 0 { return Err("Sprite cell exceeds page pixel budget".into()); }
    let rows = (8192 / cell_h).min(PIXEL_BUDGET / (cell_pixels * cols));
    Ok((cols as u32, rows as u32, cell_w as u32, cell_h as u32))
}
fn save_sheet(j:&Job,inner:&mut Inner)->Result<(),String>{
    if let Some(sheet)=inner.sheet.take(){sheet.save(j.staging.join(format!("sheet-{:04}.png",inner.sheet_page))).map_err(|e|e.to_string())?;inner.sheet_page+=1;inner.sheet_used=0;}Ok(())
}
#[tauri::command]
pub async fn write_frame(app:AppHandle,request:Request<'_>,jobs:State<'_,Jobs>)->Result<(),String>{
    let id=request.headers().get("x-job-id").and_then(|v|v.to_str().ok()).ok_or("Missing job ID")?;
    let index=request.headers().get("x-frame-index").and_then(|v|v.to_str().ok()).and_then(|s|s.parse::<u32>().ok()).ok_or("Missing frame index")?;
    let bytes=match request.body(){InvokeBody::Raw(b)=>b,_=>return Err("Expected raw binary RGBA".into())};
    let j=jobs.get(id)?;cancelled(&j)?;if j.finishing.load(Ordering::SeqCst){return Err("Job is already finalizing".into());}
    if bytes.len()!=j.settings.width as usize*j.settings.height as usize*4{return Err("RGBA byte length mismatch".into());}
    let mut inner=j.inner.lock().await;
    cancelled(&j)?;
    if j.finishing.load(Ordering::SeqCst) { return Err("Job is already finalizing".into()); }
    if index!=inner.frames||index>=j.settings.frames{return Err("Out-of-order or extra frame".into());}
    if index==0 {inner.first_has_alpha=bytes.chunks_exact(4).any(|pixel|pixel[3]<250);}
    if let Some(stdin)=inner.stdin.as_mut(){
        tokio::select!{result=stdin.write_all(bytes)=>result.map_err(|e|e.to_string())?,_=j.notify.notified()=>return Err("Export cancelled".into())};
    }else if j.settings.format=="png"{
        image::save_buffer_with_format(j.staging.join(format!("frame-{index:06}.png")),bytes,j.settings.width,j.settings.height,image::ColorType::Rgba8,image::ImageFormat::Png).map_err(|e|e.to_string())?;
    }else if j.settings.format=="sheet"{
        let (cols,rows,cw,ch)=sheet_layout(&j.settings)?;
        if inner.sheet.is_none(){inner.sheet=Some(image::RgbaImage::new(cols*cw,rows*ch));}
        let pos=inner.sheet_used;let x=(pos%cols)*cw+j.settings.sheet_padding;let y=(pos/cols)*ch+j.settings.sheet_padding;
        let frame=image::RgbaImage::from_raw(j.settings.width,j.settings.height,bytes.clone()).ok_or("Invalid frame")?;
        image::imageops::replace(inner.sheet.as_mut().ok_or("Missing sheet")?,&frame,i64::from(x),i64::from(y));inner.sheet_used+=1;
        if inner.sheet_used==cols*rows{save_sheet(&j,&mut inner)?;}
    }else{return Err("Encoder input is closed".into());}
    inner.frames+=1;progress(&app,&j,"rendering",inner.frames,"");Ok(())
}
async fn run_pass(app:&AppHandle,j:&Job,inner:&mut Inner,args:Vec<String>)->Result<(),String>{
    cancelled(j)?;
    let mut child=Command::new(j.ffmpeg.as_ref().ok_or("FFmpeg missing")?).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true).spawn().map_err(|e|e.to_string())?;
    drain(&mut child,app.clone(),j.id.clone(),j.settings.frames,inner.stderr.clone());inner.child=Some(child);
    wait_child(j,inner).await
}
async fn wait_child(j:&Job,inner:&mut Inner)->Result<(),String>{
    cancelled(j)?;
    let child=inner.child.as_mut().ok_or("Encoder process missing")?;
    let status=tokio::select!{s=child.wait()=>s.map_err(|e|e.to_string())?,_=j.notify.notified()=>{let _=child.kill().await;return Err("Export cancelled".into());}};
    if !status.success(){return Err(format!("FFmpeg failed ({status}): {}",inner.stderr.lock().map(|s|s.clone()).unwrap_or_default()));}inner.child=None;Ok(())
}
async fn finalize(app:&AppHandle,j:&Job)->Result<ExportResult,String>{
    let mut inner=j.inner.lock().await;cancelled(j)?;
    if inner.frames!=j.settings.frames{return Err("Cannot finalize incomplete frame stream".into());}
    if let Some(mut stdin)=inner.stdin.take(){stdin.shutdown().await.map_err(|e|e.to_string())?;drop(stdin);}
    if inner.child.is_some(){wait_child(j,&mut inner).await?;}
    if j.settings.format=="sheet"{save_sheet(j,&mut inner)?;}
    if j.settings.format=="gif"{
        progress(app,j,"encoding",0,"Analyzing global palette");
        let base=vec!["-hide_banner","-loglevel","error","-nostdin","-n"].into_iter().map(str::to_string).collect::<Vec<_>>();
        let intermediate=j.staging.join("intermediate.mkv").to_string_lossy().into_owned();let palette=j.staging.join("palette.png").to_string_lossy().into_owned();
        let mut args=base.clone();args.extend(["-i".into(),intermediate.clone(),"-vf".into(),format!("palettegen=max_colors={}:stats_mode=full:reserve_transparent={}",j.settings.palette_colors,u8::from(j.settings.transparent)),"-frames:v".into(),"1".into(),palette.clone()]);run_pass(app,j,&mut inner,args).await?;
        progress(app,j,"encoding",0,"Applying palette");
        let mut args=base;args.extend(["-i".into(),intermediate,"-i".into(),palette,"-lavfi".into(),format!("paletteuse=dither={}:alpha_threshold={}:diff_mode=rectangle",j.settings.dither,j.settings.alpha_threshold),"-loop".into(),j.settings.gif_repeat.to_string(),"-progress".into(),"pipe:1".into(),j.staging.join("output.gif").to_string_lossy().into_owned()]);run_pass(app,j,&mut inner,args).await?;
    }
    progress(app,j,"finalizing",j.settings.frames,"Verifying output");cancelled(j)?;
    let images=["png","sheet"].contains(&j.settings.format.as_str());
    let verification=if images {
        // Decode one bounded image at a time off the async executor. Holding the
        // job lock prevents cleanup from racing a Windows file handle; cancellation
        // is observed after at most the current image decode, not the entire export.
        let (count, expected_width, expected_height) = if j.settings.format == "sheet" {
            let (cols, rows, cw, ch) = sheet_layout(&j.settings)?;
            (inner.sheet_page, cols * cw, rows * ch)
        } else { (j.settings.frames, j.settings.width, j.settings.height) };
        for index in 0..count {
            cancelled(j)?;
            let path = j.staging.join(if j.settings.format == "sheet" {
                format!("sheet-{index:04}.png")
            } else { format!("frame-{index:06}.png") });
            tokio::task::spawn_blocking(move || -> Result<(), String> {
                let image = image::open(path).map_err(|e| e.to_string())?;
                if image.width() != expected_width || image.height() != expected_height {
                    return Err("PNG output dimensions failed verification".into());
                }
                Ok(())
            }).await.map_err(|e| e.to_string())??;
            cancelled(j)?;
        }
        "PNG files decoded successfully".to_string()
    }else{
        let output=j.staging.join(if j.settings.format=="gif"{"output.gif"}else{"output.tmp"});
        let probe_args = ["-v","error","-select_streams","v:0","-count_frames","-show_entries","stream=codec_name,pix_fmt,width,height,nb_read_frames,avg_frame_rate,duration:format=duration","-of","json",output.to_str().ok_or("Invalid output path")?];
        let probe=tokio::select! {
            result=encoders::capture_for(j.ffprobe.as_ref().ok_or("FFprobe missing")?,&probe_args,3600)=>result?,
            _=j.notify.notified()=>return Err("Export cancelled".into())
        };
        let value:serde_json::Value=serde_json::from_str(&probe).map_err(|e|e.to_string())?;let stream=&value["streams"][0];
        let frames=stream["nb_read_frames"].as_str().and_then(|n|n.parse::<u32>().ok());
        if stream["width"].as_u64()!=Some(j.settings.width as u64)||stream["height"].as_u64()!=Some(j.settings.height as u64)||frames!=Some(j.settings.frames){return Err("Output dimensions/frame count failed verification".into());}
        let expected=match j.settings.format.as_str(){"mp4"=>"h264","gif"=>"gif","prores"=>"prores","webm"=>"vp9",_=>""};
        if stream["codec_name"].as_str()!=Some(expected){return Err("Output codec failed verification".into());}
        if j.settings.format=="mp4"&&stream["pix_fmt"].as_str()!=Some("yuv420p"){return Err("H.264 pixel format mismatch".into());}
        let duration=stream["duration"].as_str().or_else(||value["format"]["duration"].as_str()).and_then(|s|s.parse::<f64>().ok());
        if let Some(duration)=duration {
            let expected=f64::from(j.settings.frames)/j.settings.fps;
            if !duration.is_finite() || (duration-expected).abs()>(2.0/j.settings.fps).max(0.05){return Err("Output duration failed verification".into());}
        } else {return Err("Output duration missing from probe".into());}
        if j.settings.format!="gif" {
            let rate=stream["avg_frame_rate"].as_str().and_then(|s|s.split_once('/')).and_then(|(a,b)|Some(a.parse::<f64>().ok()?/b.parse::<f64>().ok()?));
            if let Some(rate)=rate {if !rate.is_finite()||(rate-j.settings.fps).abs()>0.01{return Err("Output frame rate failed verification".into());}}
            else {return Err("Output frame rate missing".into());}
        }
        if j.settings.transparent && inner.first_has_alpha && ["prores","webm"].contains(&j.settings.format.as_str()) {
            let mut command=Command::new(j.ffmpeg.as_ref().ok_or("FFmpeg missing")?);
            command.args(["-v","error"]);
            if j.settings.format=="webm" {command.args(["-c:v","libvpx-vp9"]);}
            command.arg("-i").arg(&output).args(["-frames:v","1","-pix_fmt","rgba","-f","rawvideo","pipe:1"]).stdin(Stdio::null()).kill_on_drop(true);
            let decoded=tokio::select! {result=command.output()=>result.map_err(|e|e.to_string())?,_=j.notify.notified()=>return Err("Export cancelled".into())};
            if !decoded.status.success() || decoded.stdout.len()!=j.settings.width as usize*j.settings.height as usize*4 || !decoded.stdout.chunks_exact(4).any(|p|p[3]<250) {return Err("Transparent video lost alpha or failed alpha decoding".into());}
        }
        // Decode every frame to detect bitstream errors; full alpha fidelity remains a release fixture gate.
        run_pass(app,j,&mut inner,vec!["-v".into(),"error".into(),"-xerror".into(),"-i".into(),output.to_string_lossy().into_owned(),"-f".into(),"null".into(),"-".into()]).await?;
        "Codec, dimensions, frame count, timing and full decode verified; first-frame alpha checked when applicable. Visual fidelity still requires reference review".to_string()
    };
    let manifest=serde_json::json!({"schemaVersion":1,"settings":j.settings,"frameOrigin":"top-left","pixelFormat":"straight RGBA8","frameDuration":1.0/j.settings.fps,"verification":verification,"sheetLayout":if j.settings.format=="sheet"{Some(sheet_layout(&j.settings)?)}else{None}});
    tokio::fs::write(j.staging.join("manifest.json"),serde_json::to_vec_pretty(&manifest).map_err(|e|e.to_string())?).await.map_err(|e|e.to_string())?;
    if !images{let old=j.staging.join(if j.settings.format=="gif"{"output.gif"}else{"output.tmp"});tokio::fs::rename(old,j.staging.join(format!("{}.{}",filename(&j.settings.name),ext(&j.settings.format)))).await.map_err(|e|e.to_string())?;let _=tokio::fs::remove_file(j.staging.join("intermediate.mkv")).await;let _=tokio::fs::remove_file(j.staging.join("palette.png")).await;}
    cancelled(j)?;
    // Reserve a unique directory atomically; never overwrite existing output.
    let mut count=1;let target=loop{cancelled(j)?;let target=j.destination.join(format!("{}-{count:03}",filename(&j.settings.name)));match tokio::fs::create_dir(&target).await{Ok(())=>break target,Err(e)if e.kind()==std::io::ErrorKind::AlreadyExists=>{count+=1;if count>100_000{return Err("Too many output name collisions".into());}},Err(e)=>return Err(e.to_string())}};
    // Commit and cancellation compete for the same state transition. Once commit
    // wins, cancellation cannot remove staging while the atomic rename is pending.
    if j.lifecycle.compare_exchange(ACTIVE, COMMITTING, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        let _ = tokio::fs::remove_dir(&target).await;
        return Err("Export cancelled".into());
    }
    // Rename staging as a child of the reserved directory: atomic visibility for the complete payload.
    if let Err(e)=tokio::fs::rename(&j.staging,target.join("export")).await{let _=tokio::fs::remove_dir(&target).await;return Err(e.to_string());}
    let output=target.join("export");*j.output.lock().map_err(|e|e.to_string())?=Some(output.clone());
    release_buffers(&mut inner).await;
    j.lifecycle.store(COMPLETED, Ordering::SeqCst);
    progress(app,j,"completed",j.settings.frames,"");
    Ok(ExportResult{output:output.to_string_lossy().into_owned(),verification})
}
#[tauri::command]
pub async fn finish_export(app:AppHandle,id:String,jobs:State<'_,Jobs>)->Result<ExportResult,String>{
    let j=jobs.get(&id)?;if j.finishing.swap(true,Ordering::SeqCst){return Err("Job already finalized".into());}
    let result=finalize(&app,&j).await;
    if result.is_err() {
        j.lifecycle.store(FAILED, Ordering::SeqCst);
        cleanup(&j).await;
    }
    result
}
#[tauri::command]
pub async fn cancel_export(id:String,jobs:State<'_,Jobs>)->Result<(),String>{
    let j = jobs.get(&id)?;
    if j.lifecycle.load(Ordering::SeqCst) == COMPLETED { return Ok(()); }
    if !request_cancel(&j) {
        return Err("Export is already committing or completed; cancellation was not applied".into());
    }
    cleanup(&j).await;
    Ok(())
}
#[tauri::command]
pub async fn open_output(id:String,jobs:State<'_,Jobs>)->Result<(),String>{
    let j=jobs.get(&id)?;let output=j.output.lock().map_err(|e|e.to_string())?.clone().ok_or("Output is not finalized")?;
    let program=if cfg!(windows){"explorer.exe"}else if cfg!(target_os="macos"){"open"}else{"xdg-open"};
    Command::new(program).arg(output).spawn().map_err(|e|e.to_string())?;Ok(())
}

pub async fn shutdown(jobs: Vec<Arc<Job>>) {
    // Signal every job before waiting for any one operation to finish.
    for j in &jobs { request_cancel(j); }
    for j in jobs {
        if matches!(j.lifecycle.load(Ordering::SeqCst), CANCELLED | FAILED) {
            cleanup(&j).await;
        } else {
            // A commit already in progress owns publication; wait for its lock
            // before exiting rather than interrupting a completed payload rename.
            let _inner = j.inner.lock().await;
        }
    }
}
