package btools.util
import kotlin.jvm.JvmField


interface ProgressListener {
    fun updateProgress(task: String?, progress: Int)

    val isCanceled: Boolean
}
