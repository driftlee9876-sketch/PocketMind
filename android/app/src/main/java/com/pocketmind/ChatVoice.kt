package com.pocketmind

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.facebook.react.bridge.*
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale

internal class ChatVoice(private val context:ReactApplicationContext):LifecycleEventListener {
    private val main=Handler(Looper.getMainLooper())
    @Volatile private var recording=false
    @Volatile var decibels = -120.0
        private set
    private var worker:Thread?=null
    private var samples=ByteArrayOutputStream()
    private var captureError:String?=null
    private var synth:TextToSpeech?=null
    private var ready=false
    private var spoken:Promise?=null
    private var speechId=""
    init {context.addLifecycleEventListener(this)}
    fun start(p:Promise)=main.post {
        try {
            check(worker==null && context.lifecycleState==com.facebook.react.common.LifecycleState.RESUMED){"녹음을 시작할 수 없어요."}
            val size=maxOf(4096,AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT))
            val mic=AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,size)
            try{check(mic.state==AudioRecord.STATE_INITIALIZED);mic.startRecording()}catch(e:Exception){mic.release();throw e}
            samples=ByteArrayOutputStream();captureError=null;decibels = -120.0;recording=true
            worker=Thread {
                val buffer=ByteArray(size)
                try{while(recording && samples.size()<16000*2*30){
                    val n=mic.read(buffer,0,minOf(size,960000-samples.size()))
                    if(n<=0)error("마이크에서 음성을 읽지 못했어요.")
                    var energy = 0.0
                    for (i in 0 until (n - 1) step 2) {
                        val value = ((buffer[i].toInt() and 255) or (buffer[i+1].toInt() shl 8)).toShort().toDouble() / 32768.0
                        energy += value * value
                    }
                    decibels = 10.0 * kotlin.math.log10(maxOf(1e-12, energy / maxOf(n/2, 1)))
                    samples.write(buffer,0,n)
                }}catch(e:Exception){captureError=e.message}finally{runCatching{mic.stop()};mic.release()}
            }.also{it.start()};p.resolve(true)
        }catch(e:Exception){p.reject("VOICE",e)}
    }
    fun finish(p:Promise)=main.post {
        try{
            val thread=worker ?: error("녹음 중이 아니에요.")
            recording=false;thread.join(1500);check(!thread.isAlive){"마이크 종료를 기다려 주세요."};worker=null
            captureError?.let{error(it)}
            val pcm=samples.toByteArray();samples.reset();check(pcm.size>=3200){"조금 더 길게 말해 주세요."}
            val header=ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
            header.put("RIFF".toByteArray()).putInt(36+pcm.size).put("WAVEfmt ".toByteArray()).putInt(16)
                .putShort(1).putShort(1).putInt(16000).putInt(32000).putShort(2).putShort(16).put("data".toByteArray()).putInt(pcm.size)
            val file=File.createTempFile("pm-voice-",".wav",context.cacheDir)
            file.outputStream().use{it.write(header.array());it.write(pcm)};p.resolve(file.absolutePath)
        }catch(e:Exception){p.reject("VOICE",e)}
    }
    fun speak(text:String,p:Promise)=main.post {
        stopSpeech()
        spoken=p
        fun say(){
            val engine=synth ?: return
            val localVoice = engine.voices.orEmpty().filter {
                !it.isNetworkConnectionRequired && it.locale.language == Locale.KOREAN.language &&
                    TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in it.features.orEmpty()
            }.maxByOrNull { it.quality }
            if (localVoice != null) engine.voice = localVoice
            else if(engine.setLanguage(Locale.KOREAN)<0)engine.language=Locale.getDefault()
            speechId=java.util.UUID.randomUUID().toString()
            engine.setOnUtteranceProgressListener(object:UtteranceProgressListener(){
                override fun onStart(id:String?){}
                override fun onDone(id:String?){main.post{if(id==speechId){spoken?.resolve(true);spoken=null}}}
                @Deprecated("old callback") override fun onError(id:String?){main.post{if(id==speechId){spoken?.reject("VOICE","기기 음성 출력을 확인해 주세요.");spoken=null}}}
            })
            val chunks=text.chunked(TextToSpeech.getMaxSpeechInputLength()-1)
            for((index,chunk) in chunks.withIndex()){
                val id=if(index==chunks.lastIndex)speechId else "$speechId-$index"
                if(engine.speak(chunk,TextToSpeech.QUEUE_ADD,null,id)==TextToSpeech.ERROR){stopSpeech();break}
            }
        }
        if(ready)say() else {
            synth?.shutdown()
            synth=TextToSpeech(context){code->main.post{if(spoken===p){
                ready=code==TextToSpeech.SUCCESS
                if(ready)say() else {spoken=null;p.reject("VOICE","기기 음성 엔진을 사용할 수 없어요.")}
            }}}
        }
    }
    private fun stopSpeech(){speechId="";spoken?.resolve(false);spoken=null;synth?.stop()}
    fun cancel(){main.post{recording=false;worker?.join(1500);if(worker?.isAlive!=true){worker=null;samples.reset()};stopSpeech()}}
    override fun onHostPause(){cancel()}
    override fun onHostResume(){}
    override fun onHostDestroy(){cancel()}
    fun release(){cancel();main.post{synth?.shutdown();synth=null;ready=false};context.removeLifecycleEventListener(this)}
}
