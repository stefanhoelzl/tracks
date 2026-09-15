package net.stho.tracks.desktop

import java.awt.Rectangle
import java.awt.Robot
import java.awt.event.InputEvent
import java.awt.image.BufferedImage
import javax.swing.JFrame

/*
 * The window as the screen sees it: captured and clicked through the X server, the way a user would.
 * Robot needs a server that allows it — Xvfb does, a GNOME Wayland session does not.
 *
 * Only ever inside the screenshots container's Xvfb (screenshots/run.sh). Never on a developer's desktop, by a person or
 * an agent: there this is capturing and clicking someone's real screen, and asking the desktop to allow it. To see a
 * screen of the harness, run it in the container with --shot, as the screenshot tests do.
 */

/** The window's content on screen: what the app draws, without any decoration a window manager adds. */
fun JFrame.contentBounds(): Rectangle {
    val origin = contentPane.locationOnScreen
    return Rectangle(origin.x, origin.y, contentPane.width, contentPane.height)
}

fun JFrame.capture(): BufferedImage = Robot().createScreenCapture(contentBounds())

/** Clicks at ([x], [y]) in content coordinates. */
fun JFrame.click(x: Int, y: Int) {
    val bounds = contentBounds()
    Robot().apply {
        mouseMove(bounds.x + x, bounds.y + y)
        mousePress(InputEvent.BUTTON1_DOWN_MASK)
        mouseRelease(InputEvent.BUTTON1_DOWN_MASK)
    }
}
