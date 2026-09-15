package btools.router

import btools.kmp.io.BufferedWriter
import btools.kmp.io.FileWriter
import btools.kmp.util.*
import kotlin.jvm.JvmField
import kotlin.jvm.JvmStatic

abstract class Formatter {
    @JvmField
    var rc: RoutingContext? = null

    internal constructor()

    internal constructor(rc: RoutingContext?) {
        this.rc = rc
    }

    /**
     * writes the track in gpx-format to a file
     * 
     * @param filename the filename to write to
     * @param t        the track to write
     */
    @Throws(Exception::class)
    fun write(filename: String, t: OsmTrack?) {
        val bw = BufferedWriter(FileWriter(filename))
        bw.write(format(t!!)!!)
        bw.close()
    }

    @Throws(Exception::class)
    open fun read(filename: String): OsmTrack? {
        return null
    }

    /**
     * writes the track in a selected output format to a string
     * 
     * @param t the track to format
     * @return the formatted string
     */
    abstract fun format(t: OsmTrack): String?


    fun getJsonCommandIndex(cmd: Int, timode: Int): Int {
        when (cmd) {
            VoiceHint.TLU -> return 10
            VoiceHint.TU -> return 15
            VoiceHint.TSHL -> return 4
            VoiceHint.TL -> return 2
            VoiceHint.TSLL -> return 3
            VoiceHint.KL -> return 8
            VoiceHint.C -> return 1
            VoiceHint.KR -> return 9
            VoiceHint.TSLR -> return 6
            VoiceHint.TR -> return 5
            VoiceHint.TSHR -> return 7
            VoiceHint.TRU -> return 11
            VoiceHint.RNDB -> return 13
            VoiceHint.RNLB -> return 14
            VoiceHint.BL -> return 16
            VoiceHint.EL -> return if (timode == 2 || timode == 9) 17 else 8
            VoiceHint.ER -> return if (timode == 2 || timode == 9) 18 else 9
            VoiceHint.OFFR -> return 12
            else -> throw IllegalArgumentException("unknown command: " + cmd)
        }
    }

    /*
   * used by comment style, osmand style
   */
    fun getCommandString(cmd: Int, roundaboutExit: Int, timode: Int): String {
        when (cmd) {
            VoiceHint.TLU -> return "TU" // should be changed to TLU when osmand uses new voice hint constants
            VoiceHint.TU -> return "TU"
            VoiceHint.TSHL -> return "TSHL"
            VoiceHint.TL -> return "TL"
            VoiceHint.TSLL -> return "TSLL"
            VoiceHint.KL -> return "KL"
            VoiceHint.C -> return "C"
            VoiceHint.KR -> return "KR"
            VoiceHint.TSLR -> return "TSLR"
            VoiceHint.TR -> return "TR"
            VoiceHint.TSHR -> return "TSHR"
            VoiceHint.TRU -> return "TRU"
            VoiceHint.RNDB -> return "RNDB" + roundaboutExit
            VoiceHint.RNLB -> return "RNLB" + (-roundaboutExit)
            VoiceHint.BL -> return "BL"
            VoiceHint.EL -> return if (timode == 2 || timode == 9) "EL" else "KL"
            VoiceHint.ER -> return if (timode == 2 || timode == 9) "ER" else "KR"
            VoiceHint.OFFR -> return "OFFR"
            VoiceHint.END -> return "END"
            else -> throw IllegalArgumentException("unknown command: " + cmd)
        }
    }

    /*
   * used by trkpt/sym style
   */
    fun getCommandStringXX(c: Int, roundaboutExit: Int, timode: Int): String {
        when (c) {
            VoiceHint.TLU -> return "TLU"
            VoiceHint.TU -> return "TU"
            VoiceHint.TSHL -> return "TSHL"
            VoiceHint.TL -> return "TL"
            VoiceHint.TSLL -> return "TSLL"
            VoiceHint.KL -> return "KL"
            VoiceHint.C -> return "C"
            VoiceHint.KR -> return "KR"
            VoiceHint.TSLR -> return "TSLR"
            VoiceHint.TR -> return "TR"
            VoiceHint.TSHR -> return "TSHR"
            VoiceHint.TRU -> return "TRU"
            VoiceHint.RNDB -> return "RNDB" + roundaboutExit
            VoiceHint.RNLB -> return "RNLB" + (-roundaboutExit)
            VoiceHint.BL -> return "BL"
            VoiceHint.EL -> return if (timode == 2 || timode == 9) "EL" else "KL"
            VoiceHint.ER -> return if (timode == 2 || timode == 9) "ER" else "KR"
            VoiceHint.OFFR -> return "OFFR"
            else -> return "unknown command: " + c
        }
    }

    /*
   * used by gpsies style
   */
    fun getSymbolString(cmd: Int, roundaboutExit: Int, timode: Int): String {
        when (cmd) {
            VoiceHint.TLU, VoiceHint.TRU, VoiceHint.TU -> return "TU"
            VoiceHint.TSHL -> return "TSHL"
            VoiceHint.TL -> return "Left"
            VoiceHint.TSLL -> return "TSLL"
            VoiceHint.KL -> return "TSLL" // ?
            VoiceHint.C -> return "Straight"
            VoiceHint.KR -> return "TSLR" // ?
            VoiceHint.TSLR -> return "TSLR"
            VoiceHint.TR -> return "Right"
            VoiceHint.TSHR -> return "TSHR"
            VoiceHint.RNDB -> return "RNDB" + roundaboutExit
            VoiceHint.RNLB -> return "RNLB" + (-roundaboutExit)
            VoiceHint.BL -> return "BL"
            VoiceHint.EL -> return if (timode == 2 || timode == 9) "EL" else "KL"
            VoiceHint.ER -> return if (timode == 2 || timode == 9) "ER" else "KR"
            VoiceHint.OFFR -> return "OFFR"
            else -> throw IllegalArgumentException("unknown command: " + cmd)
        }
    }

    /*
   * used by new locus trkpt style
   */
    fun getLocusSymbolString(cmd: Int, roundaboutExit: Int): String {
        when (cmd) {
            VoiceHint.TLU -> return "u-turn_left"
            VoiceHint.TU -> return "u-turn"
            VoiceHint.TSHL -> return "left_sharp"
            VoiceHint.TL -> return "left"
            VoiceHint.TSLL -> return "left_slight"
            VoiceHint.KL -> return "stay_left" // ?
            VoiceHint.C -> return "straight"
            VoiceHint.KR -> return "stay_right" // ?
            VoiceHint.TSLR -> return "right_slight"
            VoiceHint.TR -> return "right"
            VoiceHint.TSHR -> return "right_sharp"
            VoiceHint.TRU -> return "u-turn_right"
            VoiceHint.RNDB -> return "roundabout_e" + roundaboutExit
            VoiceHint.RNLB -> return "roundabout_e" + (-roundaboutExit)
            VoiceHint.BL -> return "beeline"
            VoiceHint.EL -> return "exit_left"
            VoiceHint.ER -> return "exit_right"
            else -> throw IllegalArgumentException("unknown command: " + cmd)
        }
    }

    /*
   * used by osmand style
   */
    fun getMessageString(cmd: Int, roundaboutExit: Int, timode: Int): String {
        when (cmd) {
            VoiceHint.TLU -> return "u-turn" // should be changed to u-turn-left when osmand uses new voice hint constants
            VoiceHint.TU -> return "u-turn"
            VoiceHint.TSHL -> return "sharp left"
            VoiceHint.TL -> return "left"
            VoiceHint.TSLL -> return "slight left"
            VoiceHint.KL -> return "keep left"
            VoiceHint.C -> return "straight"
            VoiceHint.KR -> return "keep right"
            VoiceHint.TSLR -> return "slight right"
            VoiceHint.TR -> return "right"
            VoiceHint.TSHR -> return "sharp right"
            VoiceHint.TRU -> return "u-turn" // should be changed to u-turn-right when osmand uses new voice hint constants
            VoiceHint.RNDB -> return "Take exit " + roundaboutExit
            VoiceHint.RNLB -> return "Take exit " + (-roundaboutExit)
            VoiceHint.EL -> return if (timode == 2 || timode == 9) "exit left" else "keep left"
            VoiceHint.ER -> return if (timode == 2 || timode == 9) "exit right" else "keep right"
            else -> throw IllegalArgumentException("unknown command: " + cmd)
        }
    }

    /*
   * used by old locus style
   */
    fun getLocusAction(cmd: Int, roundaboutExit: Int): Int {
        when (cmd) {
            VoiceHint.TLU -> return 13
            VoiceHint.TU -> return 12
            VoiceHint.TSHL -> return 5
            VoiceHint.TL -> return 4
            VoiceHint.TSLL -> return 3
            VoiceHint.KL -> return 9 // ?
            VoiceHint.C -> return 1
            VoiceHint.KR -> return 10 // ?
            VoiceHint.TSLR -> return 6
            VoiceHint.TR -> return 7
            VoiceHint.TSHR -> return 8
            VoiceHint.TRU -> return 14
            VoiceHint.RNDB -> return 26 + roundaboutExit
            VoiceHint.RNLB -> return 26 - roundaboutExit
            VoiceHint.EL -> return 9
            VoiceHint.ER -> return 10
            else -> throw IllegalArgumentException("unknown command: " + cmd)
        }
    }

    /*
   * used by orux style
   */
    fun getOruxAction(cmd: Int, roundaboutExit: Int): Int {
        when (cmd) {
            VoiceHint.TLU, VoiceHint.TU, VoiceHint.TRU -> return 1003
            VoiceHint.TSHL -> return 1019
            VoiceHint.TL -> return 1000
            VoiceHint.TSLL -> return 1017
            VoiceHint.KL -> return 1015 // ?
            VoiceHint.C -> return 1002
            VoiceHint.KR -> return 1014 // ?
            VoiceHint.TSLR -> return 1016
            VoiceHint.TR -> return 1001
            VoiceHint.TSHR -> return 1018
            VoiceHint.RNDB, VoiceHint.RNLB -> return 1008 + roundaboutExit
            VoiceHint.EL -> return 1015
            VoiceHint.ER -> return 1014
            else -> throw IllegalArgumentException("unknown command: " + cmd)
        }
    }

    /*
   * used by cruiser, equivalent to getCommandString() - osmand style - when osmand changes the voice hint  constants
   */
    fun getCruiserCommandString(cmd: Int, roundaboutExit: Int): String {
        when (cmd) {
            VoiceHint.TLU -> return "TLU"
            VoiceHint.TU -> return "TU"
            VoiceHint.TSHL -> return "TSHL"
            VoiceHint.TL -> return "TL"
            VoiceHint.TSLL -> return "TSLL"
            VoiceHint.KL -> return "KL"
            VoiceHint.C -> return "C"
            VoiceHint.KR -> return "KR"
            VoiceHint.TSLR -> return "TSLR"
            VoiceHint.TR -> return "TR"
            VoiceHint.TSHR -> return "TSHR"
            VoiceHint.TRU -> return "TRU"
            VoiceHint.RNDB -> return "RNDB" + roundaboutExit
            VoiceHint.RNLB -> return "RNLB" + (-roundaboutExit)
            VoiceHint.BL -> return "BL"
            VoiceHint.EL -> return "EL"
            VoiceHint.ER -> return "ER"
            VoiceHint.OFFR -> return "OFFR"
            else -> throw IllegalArgumentException("unknown command: " + cmd)
        }
    }

    /*
   * used by cruiser, equivalent to getMessageString() - osmand style - when osmand changes the voice hint  constants
   */
    fun getCruiserMessageString(cmd: Int, roundaboutExit: Int): String {
        when (cmd) {
            VoiceHint.TLU -> return "u-turn left"
            VoiceHint.TU -> return "u-turn"
            VoiceHint.TSHL -> return "sharp left"
            VoiceHint.TL -> return "left"
            VoiceHint.TSLL -> return "slight left"
            VoiceHint.KL -> return "keep left"
            VoiceHint.C -> return "straight"
            VoiceHint.KR -> return "keep right"
            VoiceHint.TSLR -> return "slight right"
            VoiceHint.TR -> return "right"
            VoiceHint.TSHR -> return "sharp right"
            VoiceHint.TRU -> return "u-turn right"
            VoiceHint.RNDB -> return "take exit " + roundaboutExit
            VoiceHint.RNLB -> return "take exit " + (-roundaboutExit)
            VoiceHint.BL -> return "beeline"
            VoiceHint.EL -> return "exit left"
            VoiceHint.ER -> return "exit right"
            VoiceHint.OFFR -> return "offroad"
            else -> throw IllegalArgumentException("unknown command: " + cmd)
        }
    }

    companion object {
        const val MESSAGES_HEADER: String =
            "Longitude\tLatitude\tElevation\tDistance\tCostPerKm\tElevCost\tTurnCost\tNodeCost\tInitialCost\tWayTags\tNodeTags\tTime\tEnergy"

        @JvmStatic
        fun formatILon(ilon: Int): String {
            return formatPos(ilon - 180000000)
        }

        @JvmStatic
        fun formatILat(ilat: Int): String {
            return formatPos(ilat - 90000000)
        }

        private fun formatPos(p: Int): String {
            var p = p
            val negative = p < 0
            if (negative) p = -p
            val ac = CharArray(12)
            var i = 11
            while (p != 0 || i > 3) {
                ac[i--] = ('0'.code + (p % 10)).toChar()
                p /= 10
                if (i == 5) ac[i--] = '.'
            }
            if (negative) ac[i--] = '-'
            return ac.concatToString(i + 1, 12)
        }

        @JvmStatic
        fun getFormattedTime2(s: Int): String {
            var seconds = (s + 0.5).toInt()
            val hours = seconds / 3600
            val minutes = (seconds - hours * 3600) / 60
            seconds = seconds - hours * 3600 - minutes * 60
            var time = ""
            if (hours != 0) time = "" + hours + "h "
            if (minutes != 0) time = time + minutes + "m "
            if (seconds != 0) time = time + seconds + "s"
            return time
        }

        @JvmStatic
        fun getFormattedEnergy(energy: Int): String {
            return format1(energy / 3600000.0) + "kwh"
        }

        private fun format1(n: Double): String {
            val s = "" + (n * 10 + 0.5).toLong()
            val len = s.length
            return s.substring(0, len - 1) + "." + s.get(len - 1)
        }


        const val dateformat: String = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"

        @JvmStatic
        fun getFormattedTime3(time: Float): String {
            // yyyy-mm-ddThh:mm:ss.SSSZ
            return btools.kmp.TextFormat.isoUtcMillis((time * 1000f).toLong())
        }
    }
}
