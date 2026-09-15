package net.stho.tracks.plan

/**
 * A plan as the link it already is: `https://tracks.stho.net/?mode=planning#name=…&at=…&kinds=…&poi=…`.
 *
 * It is how a plan reaches the phone — a universal link, the share sheet, a paste — and how it goes back. The query
 * half is the web's view (`mode=planning`, which is what makes the web read the fragment at all), and the fragment is
 * [PlanFragment]'s.
 */
object PlanLink {
    const val ORIGIN = "https://tracks.stho.net"

    /** The link the web opens this plan from. */
    fun format(plan: Plan): String = "$ORIGIN/?mode=planning#${PlanFragment.format(plan)}"

    /**
     * The plan in the first Tracks link in [text] — which may be a bare link, or a message with one in it.
     *
     * Null when there is no planning link there, or one with no waypoints. Throws [IllegalArgumentException] for a
     * planning link whose fragment is broken, as the web does, so the phone can say so rather than keep half a plan.
     */
    fun find(text: String): Plan? {
        for (match in LINK.findAll(text)) {
            val url = match.value
            val hash = url.indexOf('#')
            if (hash < 0) continue
            val question = url.indexOf('?')
            val query = if (question in 0 until hash) url.substring(question + 1, hash) else ""
            // The web reads the first `mode`; anything else is not planning, and it drops the fragment.
            if (FormUrlEncoded.parse(query).firstOrNull { it.first == "mode" }?.second != "planning") continue

            val plan = PlanFragment.parse(url.substring(hash + 1))
            return plan.takeIf { it.waypoints.isNotEmpty() }
        }
        return null
    }

    private val LINK = Regex("""https?://(?:www\.)?tracks\.stho\.net/[^\s<>"]*""")
}
