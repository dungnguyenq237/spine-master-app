use std::{path::PathBuf,sync::Mutex,process::Stdio};
use serde::Serialize;
use tauri::State;
use tokio::process::Command;
use crate::jobs::Settings;
#[derive(Default)] pub struct EncoderConfig { pub paths:Mutex<Option<(PathBuf,PathBuf)>> }
#[derive(Serialize)] #[serde(rename_all="camelCase")]
pub struct Capabilities {ffmpeg:String,ffprobe:String,version:String,encoders:Vec<String>,pixel_formats:Vec<String>}
pub fn paths(config:&EncoderConfig)->Result<(PathBuf,PathBuf),String>{
    config.paths.lock().map_err(|e|e.to_string())?.clone().ok_or("Select a local FFmpeg executable first; FFprobe must be beside it.".into())
}
pub async fn capture(path:&PathBuf,args:&[&str])->Result<String,String>{
    capture_for(path,args,15).await
}
pub async fn capture_for(path:&PathBuf,args:&[&str],seconds:u64)->Result<String,String>{
    let out=tokio::time::timeout(std::time::Duration::from_secs(seconds),Command::new(path).args(args).stdin(Stdio::null()).kill_on_drop(true).output()).await.map_err(|_|"Encoder discovery timed out")?.map_err(|e|e.to_string())?;
    if !out.status.success(){return Err(String::from_utf8_lossy(&out.stderr).chars().take(2048).collect());}Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
async fn inspect(pair:&(PathBuf,PathBuf))->Result<Capabilities,String>{
    let version=capture(&pair.0,&["-version"]).await?;capture(&pair.1,&["-version"]).await?;
    let list=capture(&pair.0,&["-hide_banner","-encoders"]).await?;
    let encoders=list.lines().filter_map(|l|{let mut p=l.split_whitespace();let flags=p.next()?;let name=p.next()?;if flags.len()==6&&flags.starts_with('V'){Some(name.to_string())}else{None}}).collect();
    let pixels=capture(&pair.0,&["-hide_banner","-pix_fmts"]).await?;
    let pixel_formats=pixels.lines().filter_map(|l|{let mut p=l.split_whitespace();let flags=p.next()?;let name=p.next()?;if flags.len()==5&&flags.chars().all(|c|"IOHPB.".contains(c)){Some(name.to_string())}else{None}}).collect();
    Ok(Capabilities{ffmpeg:pair.0.to_string_lossy().into(),ffprobe:pair.1.to_string_lossy().into(),version:version.lines().next().unwrap_or("").into(),encoders,pixel_formats})
}
#[tauri::command] pub async fn encoder_capabilities(config:State<'_,EncoderConfig>)->Result<Capabilities,String>{inspect(&paths(&config)?).await}
#[tauri::command] pub async fn configure_encoder(config:State<'_,EncoderConfig>)->Result<Option<Capabilities>,String>{
    let Some(file)=rfd::AsyncFileDialog::new().set_title("Choose trusted FFmpeg executable").pick_file().await else{return Ok(None)};
    let ffmpeg=file.path().canonicalize().map_err(|e|e.to_string())?;
    let ffprobe=ffmpeg.with_file_name(if cfg!(windows){"ffprobe.exe"}else{"ffprobe"});
    let pair=(ffmpeg,ffprobe);let caps=inspect(&pair).await?;*config.paths.lock().map_err(|e|e.to_string())?=Some(pair);Ok(Some(caps))
}
pub fn codec(format:&str)->&str{match format{"mp4"=>"libx264","gif"=>"ffv1","prores"=>"prores_ks","webm"=>"libvpx-vp9",_=>""}}
pub async fn ensure(config:&EncoderConfig,s:&Settings)->Result<(PathBuf,PathBuf),String>{let pair=paths(config)?;let caps=inspect(&pair).await?;if !caps.encoders.iter().any(|e|e==codec(&s.format)){return Err(format!("Required encoder {} unavailable",codec(&s.format)));}Ok(pair)}
pub fn input_args(s:&Settings)->Vec<String>{vec!["-hide_banner","-loglevel","error","-nostdin","-n","-f","rawvideo","-pixel_format","rgba","-video_size"].into_iter().map(str::to_string).chain([format!("{}x{}",s.width,s.height),"-framerate".into(),s.fps.to_string(),"-i".into(),"pipe:0".into(),"-an".into()]).collect()}
pub fn output_args(s:&Settings)->Vec<String>{
    let (crf,preset)=match s.quality.as_str(){"fast"=>("20","veryfast"),"high"=>("16","slow"),"maximum"=>("14","veryslow"),_=>("18","medium")};
    let a=match s.format.as_str(){
        "mp4"=>vec!["-c:v","libx264","-crf",crf,"-preset",preset,"-pix_fmt","yuv420p","-movflags","+faststart","-color_primaries","bt709","-color_trc","bt709","-colorspace","bt709","-vf","scale=in_range=full:out_range=tv:out_color_matrix=bt709"],
        "gif"=>vec!["-c:v","ffv1","-level","3","-pix_fmt","bgra"],
        "prores"=>vec!["-c:v","prores_ks","-profile:v","4","-pix_fmt","yuva444p10le","-alpha_bits","16"],
        "webm"=>vec!["-c:v","libvpx-vp9","-pix_fmt","yuva420p","-auto-alt-ref","0","-b:v","0","-crf",crf],_=>vec![]};
    a.into_iter().map(str::to_string).chain(["-progress".into(),"pipe:1".into(),"-nostats".into()]).collect()
}
