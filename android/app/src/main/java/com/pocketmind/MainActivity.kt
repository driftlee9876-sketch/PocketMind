package com.pocketmind

import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.KeyEvent
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.WindowInsets
import android.view.WindowInsetsController
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.views.textinput.ReactEditText
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  private var handledComposerEnter = false

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val enter = event.keyCode == KeyEvent.KEYCODE_ENTER || event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER
    if (!enter || event.flags and KeyEvent.FLAG_SOFT_KEYBOARD != 0) return super.dispatchKeyEvent(event)
    if (event.action == KeyEvent.ACTION_UP && handledComposerEnter) {
      handledComposerEnter = false
      return true
    }
    val field = currentFocus as? ReactEditText
    if (event.action != KeyEvent.ACTION_DOWN || field?.getTag(com.facebook.react.R.id.view_tag_native_id) != "pocketmind-composer") {
      return super.dispatchKeyEvent(event)
    }
    val editable = field.text ?: return super.dispatchKeyEvent(event)
    if (BaseInputConnection.getComposingSpanStart(editable) >= 0) return super.dispatchKeyEvent(event)
    if (event.repeatCount > 0 && handledComposerEnter) return true
    if (event.isShiftPressed) {
      val a = field.selectionStart.coerceIn(0, editable.length)
      val b = field.selectionEnd.coerceIn(0, editable.length)
      editable.replace(minOf(a, b), maxOf(a, b), "\n")
    } else if (field.shouldSubmitOnReturn()) {
      field.onEditorAction(EditorInfo.IME_ACTION_SEND)
    } else return super.dispatchKeyEvent(event)
    handledComposerEnter = true
    return true
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    applyImmersiveNavigationMode()
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "PocketMind"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) applyImmersiveNavigationMode()
  }

  private fun applyImmersiveNavigationMode() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.insetsController?.let { controller ->
        controller.systemBarsBehavior =
          WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsets.Type.systemBars())
      }
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility =
        View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isNavigationBarContrastEnforced = false
    }
  }
}
