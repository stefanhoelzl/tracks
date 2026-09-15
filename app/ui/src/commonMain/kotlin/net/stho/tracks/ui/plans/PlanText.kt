package net.stho.tracks.ui.plans

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.stho.tracks.plan.FailedLeg
import net.stho.tracks.plan.Format
import net.stho.tracks.plan.Leg
import net.stho.tracks.plan.Plan
import net.stho.tracks.plan.Profile
import net.stho.tracks.plan.RoutedLeg
import net.stho.tracks.plan.derivedName
import net.stho.tracks.plan.planTotals
import net.stho.tracks.store.PlanRouting
import net.stho.tracks.store.StoredPlan
import net.stho.tracks.ui.theme.StatTile

/* What a stored plan says about itself, in the list and in its preview. Kept apart from both so they cannot differ. */

/** `PROFILE_LABELS` from `packages/routing/src/router.ts`. */
internal val Profile.label: String
    get() = when (this) {
        Profile.Road -> "Road"
        Profile.Trekking -> "Trekking"
        Profile.Gravel -> "Gravel"
        Profile.Mtb -> "MTB"
        Profile.Hiking -> "Hiking"
    }

/** Its name; its two ends when nobody named it, as the web's placeholder reads; and something when it has neither. */
internal fun titleOf(plan: Plan): String = plan.name.ifEmpty { derivedName(plan) }.ifEmpty { "Untitled plan" }

/** `42.3 km · 1 240 m · gravel`, from whatever legs are routed; dashes while none is, rather than a length of nothing. */
internal fun numbersOf(stored: StoredPlan): String {
    val totals = planTotals(stored.legs).takeIf { stored.legs.any { it is RoutedLeg } }
    return "${Format.km(totals?.distanceM)} km · ${Format.metres(totals?.ascentM)} m · ${stored.plan.profile.label.lowercase()}"
}

/** A plan's four numbers, as the web's tiles; dashes while no leg is routed, rather than a plan of nothing. */
@Composable
internal fun PlanTiles(legs: List<Leg?>) {
    val totals = planTotals(legs).takeIf { legs.any { it is RoutedLeg } }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StatTile("Distance", Format.km(totals?.distanceM), "km", Modifier.weight(1f))
        StatTile("Ascent", Format.metres(totals?.ascentM), "m", Modifier.weight(1f))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        StatTile("Descent", Format.metres(totals?.descentM), "m", Modifier.weight(1f))
        StatTile("Est. time", Format.duration(totals?.durationS), "h", Modifier.weight(1f))
    }
}

/** The one line to say about a plan's legs, most urgent first; null when every leg is routed. */
internal fun statusOf(stored: StoredPlan, routing: PlanRouting?): String? {
    val legs = stored.legs.size
    val inFlight = routing?.routing
    return when {
        legs == 0 -> "Nothing to route yet"
        inFlight != null -> "Routing leg ${inFlight + 1} of $legs…"
        !routing?.errors.isNullOrEmpty() -> "The router failed: ${routing.errors.values.first()}"
        !routing?.noData.isNullOrEmpty() -> "No routing data for this area on the phone yet"
        stored.legs.any { it == null } -> "Waiting to be routed"
        stored.legs.any { it is FailedLeg } -> "One leg could not be routed, so these totals are short by it."
        else -> null
    }
}
