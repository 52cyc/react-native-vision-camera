import Foundation
import NitroModules
import Security

private final class MemoryRequest: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
  let promise = Promise<HttpResponse>()
  let progress: (Double, Double) -> Void
  let isListing: Bool
  let finished: () -> Void
  private var received = Data()
  private var status = 0
  private var tooLarge = false

  init(
    isListing: Bool, progress: @escaping (Double, Double) -> Void, finished: @escaping () -> Void
  ) {
    self.isListing = isListing
    self.progress = progress
    self.finished = finished
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    // Do not forward credentials or repeat uploads at a different destination.
    completionHandler(nil)
  }
  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    status = (response as? HTTPURLResponse)?.statusCode ?? 0
    completionHandler(.allow)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard received.count + data.count <= 32 * 1024 * 1024 else {
      tooLarge = true
      dataTask.cancel()
      return
    }
    received.append(data)
  }
  func urlSession(
    _ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
    totalBytesSent: Int64, totalBytesExpectedToSend: Int64
  ) {
    progress(Double(totalBytesSent), Double(totalBytesExpectedToSend))
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    defer {
      received.removeAll(keepingCapacity: false)
      finished()
      session.finishTasksAndInvalidate()
    }
    if let error = error as NSError? {
      let message =
        tooLarge
        ? "RESPONSE_TOO_LARGE" : (error.code == NSURLErrorTimedOut ? "TIMEOUT" : "NETWORK_OR_TLS")
      promise.reject(withError: RuntimeError.error(withMessage: message))
      return
    }
    do {
      let buffer =
        received.isEmpty ? ArrayBuffer.allocate(size: 0) : try ArrayBuffer.copy(data: received)
      promise.resolve(
        withResult: HttpResponse(
          status: Double(status),
          text: isListing ? String(data: received, encoding: .utf8) ?? "" : "", body: buffer))
    } catch {
      promise.reject(withError: RuntimeError.error(withMessage: "INVALID_RESPONSE"))
    }
  }
}

final class HybridSnapPortBridge: HybridSnapPortBridgeSpec {
  private let lock = NSLock()
  private var tasks: [String: URLSessionTask] = [:]
  func randomID() throws -> String { UUID().uuidString.lowercased() }
  func locale() throws -> String { Locale.preferredLanguages.first ?? "en" }
  func cancelAll() throws {
    lock.lock()
    let active = Array(tasks.values)
    lock.unlock()
    for task in active { task.cancel() }
  }
  func request(
    id: String, method: String, url: String, headersJSON: String, body: ArrayBuffer?,
    onProgress: @escaping (Double, Double) -> Void
  ) throws -> Promise<HttpResponse> {
    guard let endpoint = URL(string: url), endpoint.scheme == "https", endpoint.user == nil,
      endpoint.password == nil,
      ["PUT", "GET", "PROPFIND", "MKCOL", "DELETE", "HEAD"].contains(method)
    else {
      throw RuntimeError.error(withMessage: "INVALID_REQUEST")
    }
    var request = URLRequest(
      url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 90)
    request.httpMethod = method
    let headers =
      try JSONSerialization.jsonObject(with: Data(headersJSON.utf8)) as? [String: String] ?? [:]
    for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
    request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    request.httpBody = body?.toData(copyIfNeeded: true)
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.urlCredentialStorage = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.timeoutIntervalForRequest = 30
    configuration.timeoutIntervalForResource = 90
    let delegate = MemoryRequest(isListing: method == "PROPFIND", progress: onProgress) {
      [weak self] in
      guard let self else { return }
      self.lock.lock()
      self.tasks.removeValue(forKey: id)
      self.lock.unlock()
    }
    let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    // Foreground data task with an in-memory HTTP body. No file/background upload API.
    let task = session.dataTask(with: request)
    lock.lock()
    tasks[id] = task
    lock.unlock()
    task.resume()
    return delegate.promise
  }

  private var query: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "SnapPort.vault.v1", kSecAttrAccount as String: "connections",
    ]
  }
  func readVault() throws -> Promise<String> {
    return Promise.async {
      var query = self.query
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      var result: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &result)
      if status == errSecItemNotFound { return "" }
      guard status == errSecSuccess, let data = result as? Data,
        let value = String(data: data, encoding: .utf8)
      else {
        throw RuntimeError.error(withMessage: "VAULT_READ_FAILED")
      }
      return value
    }
  }
  func writeVault(value: String) throws -> Promise<Void> {
    return Promise.async {
      let attributes: [String: Any] = [
        kSecValueData as String: Data(value.utf8),
        kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      ]
      var status = SecItemUpdate(self.query as CFDictionary, attributes as CFDictionary)
      if status == errSecItemNotFound {
        status = SecItemAdd(self.query.merging(attributes) { _, new in new } as CFDictionary, nil)
      }
      guard status == errSecSuccess else {
        throw RuntimeError.error(withMessage: "VAULT_WRITE_FAILED")
      }
    }
  }
}
