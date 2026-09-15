/**
 * Container for routig configs
 * 
 * @author ab
 */
package btools.mapaccess
import kotlin.jvm.JvmField

interface OsmLinkHolder {
    var nextForLink: OsmLinkHolder?
}
