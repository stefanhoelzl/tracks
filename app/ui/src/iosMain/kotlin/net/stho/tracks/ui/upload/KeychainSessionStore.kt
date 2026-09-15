package net.stho.tracks.ui.upload

import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.CPointer
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.alloc
import kotlinx.cinterop.convert
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.value
import net.stho.tracks.upload.Session
import net.stho.tracks.upload.SessionStore
import platform.CoreFoundation.CFDictionaryAddValue
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFRelease
import platform.CoreFoundation.CFStringRef
import platform.CoreFoundation.CFTypeRef
import platform.CoreFoundation.CFTypeRefVar
import platform.CoreFoundation.kCFBooleanTrue
import platform.CoreFoundation.kCFTypeDictionaryKeyCallBacks
import platform.CoreFoundation.kCFTypeDictionaryValueCallBacks
import platform.Foundation.CFBridgingRelease
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Foundation.dataUsingEncoding
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccessible
import platform.Security.kSecAttrAccessibleAfterFirstUnlock
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData

/**
 * The session in the Keychain: one generic password, holding the address and the token.
 *
 * Readable after the phone's first unlock since it started, and not only while it is unlocked, so a ride saved and
 * uploaded with the phone in a pocket still has its session. It stays on this phone: not synced, and not in a backup
 * restored onto another.
 */
@OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
class KeychainSessionStore(private val service: String = "net.stho.tracks.session") : SessionStore {
    override fun load(): Session? {
        val (email, token) = read() ?: return null
        return if (email != null && token != null) Session(email, token) else null
    }

    override fun save(session: Session) = write(session.email, session.token)

    override fun forget() = write(lastEmail(), null)

    override fun lastEmail(): String? = read()?.first

    private fun read(): Pair<String?, String?>? = memScoped {
        val result = alloc<CFTypeRefVar>()
        val status = query(kSecReturnData to kCFBooleanTrue, kSecMatchLimit to kSecMatchLimitOne) { SecItemCopyMatching(it, result.ptr) }
        if (status != errSecSuccess) return null
        val data = CFBridgingRelease(result.value) as? NSData ?: return null
        val lines = NSString.create(data = data, encoding = NSUTF8StringEncoding)?.toString()?.lines() ?: return null
        lines.getOrNull(0)?.ifEmpty { null } to lines.getOrNull(1)?.ifEmpty { null }
    }

    private fun write(email: String?, token: String?) {
        query { SecItemDelete(it) }
        val data = NSString.create(string = "${email.orEmpty()}\n${token.orEmpty()}\n").dataUsingEncoding(NSUTF8StringEncoding) ?: return
        val value = CFBridgingRetain(data)
        try {
            query(kSecValueData to value, kSecAttrAccessible to kSecAttrAccessibleAfterFirstUnlock) { SecItemAdd(it, null) }
        } finally {
            CFRelease(value)
        }
    }

    /** Runs [call] with this store's item as a query, plus [extra] attributes, and releases what it built. */
    private fun <T> query(vararg extra: Pair<CFStringRef?, CFTypeRef?>, call: (CPointer<cnames.structs.__CFDictionary>?) -> T): T {
        val serviceName = CFBridgingRetain(NSString.create(string = service))
        val dictionary = CFDictionaryCreateMutable(null, (extra.size + 2).convert(), kCFTypeDictionaryKeyCallBacks.ptr, kCFTypeDictionaryValueCallBacks.ptr)
        try {
            CFDictionaryAddValue(dictionary, kSecClass, kSecClassGenericPassword)
            CFDictionaryAddValue(dictionary, kSecAttrService, serviceName)
            extra.forEach { (key, value) -> CFDictionaryAddValue(dictionary, key, value) }
            return call(dictionary)
        } finally {
            CFRelease(dictionary)
            CFRelease(serviceName)
        }
    }
}
