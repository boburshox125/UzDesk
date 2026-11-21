package uz.uzdesk.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap

class MainActivity : Activity() {
    private lateinit var web: WebView
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private val found = ConcurrentHashMap<String, JSONObject>()
    private var discoverySock: DatagramSocket? = null
    private var mcLock: WifiManager.MulticastLock? = null
    @Volatile private var alive = true

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#0b1020")
        window.navigationBarColor = Color.parseColor("#0b1020")
        WebView.setWebContentsDebuggingEnabled(true)

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#0b1020"))
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            textZoom = 100
            setSupportZoom(false)
            builtInZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.addJavascriptInterface(Bridge(), "UzAndroid")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.scheme == "file") return false
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Exception) {}
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null)
                fileCb = cb
                val i = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
                return try {
                    startActivityForResult(Intent.createChooser(i, "Fayl tanlang"), REQ_FILE)
                    true
                } catch (e: Exception) {
                    fileCb = null
                    false
                }
            }
        }
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("file:///android_asset/index.html")
        startDiscovery()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE) {
            val cb = fileCb
            fileCb = null
            if (cb == null) return
            if (resultCode != RESULT_OK || data == null) { cb.onReceiveValue(null); return }
            val uris = ArrayList<Uri>()
            data.clipData?.let { cd -> for (k in 0 until cd.itemCount) uris.add(cd.getItemAt(k).uri) }
            if (uris.isEmpty()) data.data?.let { uris.add(it) }
            cb.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
            return
        }
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.uzOnBack && window.uzOnBack()) ? 'y' : 'n'") { r ->
            if (r == null || !r.contains("y")) finish()
        }
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        alive = false
        try { discoverySock?.close() } catch (_: Exception) {}
        try { mcLock?.release() } catch (_: Exception) {}
        web.destroy()
        super.onDestroy()
    }

    private fun applyImmersive(on: Boolean) {
        if (Build.VERSION.SDK_INT >= 30) {
            val c = window.insetsController ?: return
            if (on) {
                c.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                c.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            } else {
                c.show(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = if (on)
                (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
            else View.SYSTEM_UI_FLAG_VISIBLE
        }
    }

    private fun startDiscovery() {
        try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            mcLock = wm.createMulticastLock("uzdesk").apply { setReferenceCounted(false); acquire() }
        } catch (_: Exception) {}
        Thread {
            while (alive) {
                try {
                    val s = DatagramSocket(null)
                    s.reuseAddress = true
                    s.broadcast = true
                    s.bind(InetSocketAddress(8766))
                    discoverySock = s
                    val buf = ByteArray(2048)
                    while (alive) {
                        val p = DatagramPacket(buf, buf.size)
                        s.receive(p)
                        try {
                            val o = JSONObject(String(p.data, 0, p.length, Charsets.UTF_8))
                            if (o.optInt("uzdesk") == 1 && o.has("id")) {
                                o.put("ip", p.address.hostAddress)
                                o.put("seen", System.currentTimeMillis())
                                found[o.getString("id")] = o
                            }
                        } catch (_: Exception) {}
                    }
                } catch (_: Exception) {
                    try { Thread.sleep(3000) } catch (_: Exception) {}
                }
            }
        }.apply { isDaemon = true; name = "uz-discovery" }.start()
    }

    inner class Bridge {
        @JavascriptInterface
        fun deviceName(): String {
            val m = Build.MODEL ?: "Android"
            val b = Build.MANUFACTURER ?: ""
            return if (m.lowercase().startsWith(b.lowercase())) m else "$b $m".trim()
        }

        @JavascriptInterface
        fun discovered(): String {
            val now = System.currentTimeMillis()
            val arr = JSONArray()
            for (o in found.values) if (now - o.optLong("seen") < 8000) arr.put(o)
            return arr.toString()
        }

        @JavascriptInterface
        fun vibrate(ms: Int) {
            try {
                val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                v.vibrate(VibrationEffect.createOneShot(ms.toLong(), 80))
            } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun keepScreenOn(on: Boolean) {
            runOnUiThread {
                if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

        @JavascriptInterface
        fun setFullscreen(on: Boolean) { runOnUiThread { applyImmersive(on) } }

        @JavascriptInterface
        fun showKeyboard() {
            runOnUiThread {
                web.requestFocus()
                val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT)
            }
        }

        @JavascriptInterface
        fun getClipboard(): String {
            return try {
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = cm.primaryClip ?: return ""
                if (clip.itemCount == 0) "" else (clip.getItemAt(0).coerceToText(this@MainActivity)?.toString() ?: "")
            } catch (_: Exception) { "" }
        }

        @JavascriptInterface
        fun setClipboard(text: String) {
            runOnUiThread {
                try {
                    val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("UzDesk", text))
                } catch (_: Exception) {}
            }
        }
    }

    companion object {
        private const val REQ_FILE = 42
    }
}
