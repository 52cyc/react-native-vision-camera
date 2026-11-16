package com.margelo.nitro.snapport

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.core.Promise
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import org.json.JSONObject

@Keep
@DoNotStrip
class HybridSnapPortBridge : HybridSnapPortBridgeSpec() {
  private val client = OkHttpClient.Builder()
    .followRedirects(false).followSslRedirects(false)
    .retryOnConnectionFailure(false).cache(null)
    .callTimeout(90, TimeUnit.SECONDS).connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS).writeTimeout(30, TimeUnit.SECONDS).build()
  private val calls = ConcurrentHashMap<String, Call>()
  override fun randomID() = UUID.randomUUID().toString()
  override fun locale() = java.util.Locale.getDefault().toLanguageTag()
  override fun cancelAll() { calls.values.forEach { it.cancel() } }

  override fun request(id: String, method: String, url: String, headersJSON: String,
    body: ArrayBuffer?, onProgress: (Double, Double) -> Unit): Promise<HttpResponse> {
    // Acquire ownership synchronously before leaving the JS thread.
    val owned = body?.asOwning()
    return Promise.parallel {
      require(url.startsWith("https://")) { "HTTPS_REQUIRED" }
      require(method in listOf("PUT", "GET", "PROPFIND", "MKCOL", "DELETE", "HEAD")) { "METHOD_INVALID" }
      val headers = JSONObject(headersJSON)
      val requestBody = if (owned != null) object : RequestBody() {
        override fun contentType() = headers.optString("Content-Type").toMediaTypeOrNull()
        override fun contentLength() = owned.size.toLong()
        override fun isOneShot() = true
        override fun writeTo(sink: BufferedSink) {
          val buffer = owned.getBuffer(false).duplicate()
          val chunk = ByteArray(64 * 1024)
          var sent = 0L
          while (buffer.hasRemaining()) {
            val count = minOf(buffer.remaining(), chunk.size)
            buffer.get(chunk, 0, count)
            sink.write(chunk, 0, count)
            sent += count
            onProgress(sent.toDouble(), contentLength().toDouble())
          }
        }
      } else if (method in listOf("PUT", "PROPFIND", "MKCOL")) object : RequestBody() {
        override fun contentType() = null
        override fun contentLength() = 0L
        override fun writeTo(sink: BufferedSink) {}
      } else null
      val builder = Request.Builder().url(url).method(method, requestBody)
      for (name in headers.keys()) builder.header(name, headers.getString(name))
      builder.header("Cache-Control", "no-store")
      val call = client.newCall(builder.build())
      calls[id] = call
      try {
        call.execute().use { response ->
          // Bound listing/preview memory even for chunked responses with no length header.
          val stream = response.body?.byteStream()
          val output = java.io.ByteArrayOutputStream()
          if (stream != null) {
            val chunk = ByteArray(64 * 1024)
            while (true) {
              val count = stream.read(chunk)
              if (count < 0) break
              require(output.size() + count <= 32 * 1024 * 1024) { "RESPONSE_TOO_LARGE" }
              output.write(chunk, 0, count)
            }
          }
          val bytes = output.toByteArray()
          val text = if (method == "PROPFIND") bytes.toString(Charsets.UTF_8) else ""
          HttpResponse(response.code.toDouble(), text, ArrayBuffer.wrap(bytes))
        }
      } catch (e: Exception) {
        // Never expose request URLs, server responses or Authorization headers in JS errors.
        throw Exception(if (e is java.io.InterruptedIOException) "TIMEOUT" else "NETWORK_OR_TLS", null)
      } finally { calls.remove(id) }
    }
  }

  private val context get() = requireNotNull(NitroModules.applicationContext)
  private val alias = "snapport.vault.v1"
  @Synchronized private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  override fun readVault(): Promise<String> = Promise.parallel {
    val value = context.getSharedPreferences(alias, 0).getString("encrypted", null)
    if (value == null) "" else {
      val bytes = Base64.decode(value, Base64.NO_WRAP)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
      String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }
  }
  override fun writeVault(value: String): Promise<Unit> = Promise.parallel {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val encrypted = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    check(context.getSharedPreferences(alias, 0).edit()
      .putString("encrypted", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) { "VAULT_WRITE_FAILED" }
  }
}
