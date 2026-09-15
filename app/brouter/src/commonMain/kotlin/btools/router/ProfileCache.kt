/**
 * Container for routig configs
 * 
 * @author ab
 */
package btools.router

import btools.expressions.BExpressionContextNode
import btools.expressions.BExpressionContextWay
import btools.expressions.BExpressionMetaData
import btools.kmp.io.File
import btools.kmp.System
import kotlin.jvm.JvmStatic
import btools.kmp.synchronized

class ProfileCache {
    private var expctxWay: BExpressionContextWay? = null
    private var expctxNode: BExpressionContextNode? = null
    private var lastProfileFile: File? = null
    private var lastProfileTimestamp: Long = 0
    private var profilesBusy = false
    private var lastUseTime: Long = 0

    companion object {
        private var lastLookupFile: File? = null
        private var lastLookupTimestamp: Long = 0

        private var apc = arrayOfNulls<ProfileCache>(1)
        private val debug = System.getBoolean("debugProfileCache")

        fun setSize(size: Int) {
            synchronized(this) {
                apc = arrayOfNulls<ProfileCache>(size)
            }
        }

        @JvmStatic
        fun parseProfile(rc: RoutingContext): Boolean {
            synchronized(this) {
                val profileBaseDir = System.getProperty("profileBaseDir")
                val profileDir: File?
                val profileFile: File?
                if (profileBaseDir == null) {
                    profileDir = File(rc.localFunction!!).getParentFile()
                    profileFile = File(rc.localFunction!!)
                } else {
                    profileDir = File(profileBaseDir)
                    profileFile = File(profileDir, rc.localFunction + ".brf")
                }

                rc.profileTimestamp = profileFile.lastModified() + rc.keyValueChecksum shl 24
                val lookupFile = File(profileDir, "lookups.dat")

                // invalidate cache at lookup-table update
                if (!(lookupFile == lastLookupFile && lookupFile.lastModified() == lastLookupTimestamp)) {
                    if (lastLookupFile != null) {
                        println("******** invalidating profile-cache after lookup-file update ******** ")
                    }
                    apc = arrayOfNulls<ProfileCache>(apc.size)
                    lastLookupFile = lookupFile
                    lastLookupTimestamp = lookupFile.lastModified()
                }

                var lru: ProfileCache? = null
                var unusedSlot = -1

                // check for re-use
                for (i in apc.indices) {
                    val pc: ProfileCache? = apc[i]

                    if (pc != null) {
                        if ((!pc.profilesBusy) && profileFile == pc.lastProfileFile) {
                            if (rc.profileTimestamp == pc.lastProfileTimestamp) {
                                rc.expctxWay = pc.expctxWay!!
                                rc.expctxNode = pc.expctxNode!!
                                rc.readGlobalConfig()
                                pc.profilesBusy = true
                                return true
                            }
                            lru = pc // name-match but timestamp-mismatch -> we overide this one
                            unusedSlot = -1
                            break
                        }
                        if (lru == null || lru.lastUseTime > pc.lastUseTime) {
                            lru = pc
                        }
                    } else if (unusedSlot < 0) {
                        unusedSlot = i
                    }
                }

                val meta = BExpressionMetaData()

                rc.expctxWay = BExpressionContextWay(rc.memoryclass * 512, meta)
                rc.expctxNode = BExpressionContextNode(0, meta)
                rc.expctxNode!!.setForeignContext(rc.expctxWay!!)

                meta.readMetaData(File(profileDir, "lookups.dat"))

                rc.expctxWay!!.parseFile(profileFile, "global", rc.keyValues)
                rc.expctxNode!!.parseFile(profileFile, "global", rc.keyValues)

                rc.readGlobalConfig()

                if (rc.processUnusedTags) {
                    rc.expctxWay!!.setAllTagsUsed()
                }

                if (lru == null || unusedSlot >= 0) {
                    lru = ProfileCache()
                    if (unusedSlot >= 0) {
                        apc[unusedSlot] = lru
                        if (debug) println("******* adding new profile at idx=" + unusedSlot + " for " + profileFile)
                    }
                }

                if (lru.lastProfileFile != null) {
                    if (debug) println("******* replacing profile of age " + ((System.currentTimeMillis() - lru.lastUseTime) / 1000L) + " sec " + lru.lastProfileFile + "->" + profileFile)
                }

                lru.lastProfileTimestamp = rc.profileTimestamp
                lru.lastProfileFile = profileFile
                lru.expctxWay = rc.expctxWay
                lru.expctxNode = rc.expctxNode
                lru.profilesBusy = true
                lru.lastUseTime = System.currentTimeMillis()
                return false
            }
        }

        @JvmStatic
        fun releaseProfile(rc: RoutingContext) {
            synchronized(this) {
                for (i in apc.indices) {
                    val pc: ProfileCache? = apc[i]

                    if (pc != null) {
                        // only the thread that holds the cached instance can release it
                        if (rc.expctxWay == pc.expctxWay && rc.expctxNode == pc.expctxNode) {
                            pc.profilesBusy = false
                            break
                        }
                    }
                }
            }
        }
    }
}
