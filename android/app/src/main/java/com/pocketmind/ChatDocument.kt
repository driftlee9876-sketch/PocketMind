package com.pocketmind

import android.app.Activity
import android.content.Intent
import android.provider.OpenableColumns
import com.facebook.react.bridge.*

internal class ChatDocument(private val context: ReactApplicationContext) : BaseActivityEventListener() {
    private var pending: Promise? = null
    init { context.addActivityEventListener(this) }
    fun pick(promise: Promise) {
        val activity=context.currentActivity ?: return promise.reject("DOCUMENT","앱을 화면에 열어 주세요.")
        activity.runOnUiThread {
            if(pending!=null){promise.reject("DOCUMENT","파일 선택기가 열려 있어요.");return@runOnUiThread}
            try {
                pending=promise
                val intent=Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                intent.putExtra(Intent.EXTRA_MIME_TYPES,arrayOf("text/*","application/json","application/xml"))
                activity.startActivityForResult(intent,17330)
            }catch(e:Exception){pending=null;promise.reject("DOCUMENT",e)}
        }
    }
    override fun onActivityResult(activity:Activity, requestCode:Int, resultCode:Int, data:Intent?) {
        if(requestCode!=17330)return
        val promise=pending ?: return
        pending=null
        val uri=data?.data
        if(resultCode!=Activity.RESULT_OK || uri==null){promise.resolve(null);return}
        Thread {
            try {
                val r=context.contentResolver
                val name=r.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use {
                    if(it.moveToFirst()) it.getString(0) else null
                } ?: "문서"
                val chars=CharArray(32001)
                val count=r.openInputStream(uri)?.bufferedReader(Charsets.UTF_8)?.use { reader ->
                    var used=0
                    while(used<chars.size){val n=reader.read(chars,used,chars.size-used);if(n<=0)break;used+=n}
                    used
                } ?: error("문서를 열 수 없어요.")
                val text=String(chars,0,minOf(count,32000))
                require(text.isNotBlank() && !text.contains('\u0000')){"UTF-8 텍스트 문서를 선택해 주세요."}
                promise.resolve(Arguments.createMap().apply{putString("name",name);putString("text",text);putBoolean("truncated",count>32000)})
            }catch(e:Exception){promise.reject("DOCUMENT",e)}
        }.start()
    }
    fun release(){context.removeActivityEventListener(this);pending?.resolve(null);pending=null}
}
