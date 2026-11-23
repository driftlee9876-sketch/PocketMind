package com.pocketmind

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.util.Base64
import com.facebook.react.bridge.*
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeEncoder
import com.journeyapps.barcodescanner.ScanOptions
import java.io.ByteArrayOutputStream

internal class CableQr(private val context: ReactApplicationContext) : BaseActivityEventListener() {
    private var pending: Promise? = null
    init { context.addActivityEventListener(this) }
    fun scan(promise: Promise) {
        val activity = context.currentActivity ?: run { promise.reject("QR", "앱을 화면에 열어 주세요."); return }
        activity.runOnUiThread {
            if (pending != null) { promise.reject("QR", "이미 카메라가 열려 있어요."); return@runOnUiThread }
            try {
                pending = promise
                val options = ScanOptions().setDesiredBarcodeFormats(BarcodeFormat.QR_CODE.name)
                    .setBeepEnabled(false).setPrompt("보조 기기에 표시된 GPU 연결 QR을 비춰 주세요.")
                activity.startActivityForResult(options.createScanIntent(activity), 17312)
            } catch (e: Exception) { pending = null; promise.reject("QR", e) }
        }
    }
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != 17312) return
        val value = data?.getStringExtra("SCAN_RESULT").orEmpty()
        pending?.resolve(if (resultCode == Activity.RESULT_OK && value.startsWith("pmgpu1|") && value.length < 200) value else "")
        pending = null
    }
    fun image(value: String, promise: Promise) {
        try {
            require(value.startsWith("pmgpu1|") && value.length < 200)
            val bitmap = BarcodeEncoder().encodeBitmap(value, BarcodeFormat.QR_CODE, 400, 400)
            val bytes = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes)
            bitmap.recycle()
            promise.resolve("data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
        } catch (e: Exception) { promise.reject("QR", e) }
    }
    fun release() { pending?.resolve(""); pending = null; context.removeActivityEventListener(this) }
}
