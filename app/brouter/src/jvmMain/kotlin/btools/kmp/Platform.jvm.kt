package btools.kmp

actual object Platform {
    actual fun currentTimeMillis(): Long = java.lang.System.currentTimeMillis()

    actual fun printLine(s: String, isErr: Boolean) {
        if (isErr) java.lang.System.err.println(s) else java.lang.System.out.println(s)
    }
}
