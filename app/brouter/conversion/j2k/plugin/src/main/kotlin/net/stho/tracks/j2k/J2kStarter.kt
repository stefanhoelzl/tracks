package net.stho.tracks.j2k

import com.intellij.ide.impl.OpenProjectTask
import com.intellij.openapi.application.ModernApplicationStarter
import com.intellij.openapi.application.edtWriteAction
import com.intellij.openapi.application.readAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.module.ModuleManager
import com.intellij.openapi.project.DumbService
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ex.ProjectManagerEx
import com.intellij.openapi.projectRoots.JavaSdk
import com.intellij.openapi.projectRoots.ProjectJdkTable
import com.intellij.openapi.roots.ModuleRootManager
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.backend.observation.Observation
import com.intellij.psi.JavaRecursiveElementWalkingVisitor
import com.intellij.psi.PsiJavaCodeReferenceElement
import com.intellij.psi.PsiJavaFile
import com.intellij.psi.PsiManager
import com.intellij.psi.util.PsiTreeUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jetbrains.kotlin.idea.actions.JavaToKotlinActionHandler
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.writeText
import kotlin.system.exitProcess

/**
 * `idea.sh j2k <projectDir> <report.json> <sourceDir>...`
 *
 * Writes a one-module IntelliJ project into projectDir (each sourceDir is `<name>/java` under it and becomes
 * a source root; the module gets the container's JDK and the Kotlin plugin's own kotlin-stdlib), opens it,
 * waits for indexing, checks that the Java resolves, and runs the Kotlin plugin's Java->Kotlin action
 * handler (K2 J2K, with external-usage processing and post-processing, exactly as "Convert Java File to
 * Kotlin File" does) over every .java file. Files are converted in place (.java renamed to .kt).
 */
class J2kStarter : ModernApplicationStarter() {
    override suspend fun start(args: List<String>) {
        val rest = if (args.firstOrNull() == "j2k") args.drop(1) else args
        val code = try {
            run(Path.of(rest[0]), Path.of(rest[1]), rest.drop(2))
            0
        } catch (t: Throwable) {
            System.err.println("J2K-HEADLESS FAILED: $t")
            t.printStackTrace()
            1
        }
        System.out.flush()
        exitProcess(code)
    }

    private fun log(msg: String) = println("[j2k-headless] $msg")

    private suspend fun run(projectDir: Path, reportPath: Path, sourceDirs: List<String>) {
        val jdkHome = System.getenv("PROJECT_JDK") ?: error("PROJECT_JDK not set")
        val ideHome = System.getProperty("idea.home.path") ?: "/opt/idea"
        val stdlib = Path.of(ideHome, "plugins/Kotlin/kotlinc/lib/kotlin-stdlib.jar")
        check(Files.exists(stdlib)) { "no kotlin-stdlib at $stdlib" }
        val t0 = System.nanoTime()

        writeProject(projectDir, sourceDirs, stdlib)

        val jdkName = "project-jdk"
        edtWriteAction {
            val table = ProjectJdkTable.getInstance()
            table.findJdk(jdkName)?.let { table.removeJdk(it) }
            table.addJdk(JavaSdk.getInstance().createJdk(jdkName, jdkHome, false))
        }
        log("JDK $jdkHome registered")

        LocalFileSystem.getInstance().refreshAndFindFileByNioFile(projectDir)!!.also {
            VfsUtilCore.visitChildrenRecursively(it, object : com.intellij.openapi.vfs.VirtualFileVisitor<Any>() {})
        }
        val project = ProjectManagerEx.getInstanceEx().openProjectAsync(projectDir, OpenProjectTask())
            ?: error("could not open $projectDir")
        log("project opened")
        Observation.awaitConfiguration(project)
        withContext(Dispatchers.Default) { DumbService.getInstance(project).waitForSmartMode() }
        val tIndexed = System.nanoTime()
        log("indexed in ${(tIndexed - t0) / 1_000_000} ms")

        val module = readAction { ModuleManager.getInstance(project).modules.single() }
        val allFiles = readAction { javaFiles(project, module.let { ModuleRootManager.getInstance(it).sourceRoots.toList() }) }
        // J2K_ONLY=A.java,B.java converts just those files (diagnostic runs); the rest stay Java and resolvable.
        val only = System.getenv("J2K_ONLY")?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }?.toSet()
        val files = if (only == null) allFiles else allFiles.filter { it.name in only }
        val kotlinConfigured = readAction {
            runCatching {
                project.getService(org.jetbrains.kotlin.j2k.J2KKotlinConfigurationService::class.java).checkKotlinIsConfigured(module)
            }.getOrElse { "error: $it" }
        }
        log("kotlin configured for module: $kotlinConfigured")
        val sdkHome = readAction { ModuleRootManager.getInstance(module).sdk?.homePath }
        log("${files.size} Java files, module ${module.name}, sdk $sdkHome")
        // A module without roots or JDK would "convert" nothing, or convert without type information.
        check(files.isNotEmpty()) { "module ${module.name} has no Java files under its source roots" }
        check(sdkHome != null) { "module ${module.name} has no JDK" }

        // Type resolution sanity check: J2K's nullability and override decisions depend on it.
        val (syntaxErrors, unresolved) = readAction {
            val errs = files.filter { PsiTreeUtil.hasErrorElements(it) }.map { it.name }
            val unres = mutableListOf<String>()
            for (f in files) {
                f.accept(object : JavaRecursiveElementWalkingVisitor() {
                    override fun visitReferenceElement(reference: PsiJavaCodeReferenceElement) {
                        super.visitReferenceElement(reference)
                        if (reference.advancedResolve(false).element == null && reference.multiResolve(false).isEmpty()) {
                            unres += "${f.name}: ${reference.text}"
                        }
                    }
                })
            }
            errs to unres
        }
        log("syntax-error files: ${syntaxErrors.size}; unresolved references: ${unresolved.size}")
        unresolved.take(30).forEach { log("  unresolved $it") }
        val tChecked = System.nanoTime()

        // J2K_MODE=batch (default): all files in one convertFiles call, as selecting the source roots in the IDE.
        // J2K_MODE=perfile: one file per call, callees before callers, re-indexing in between, so each file is
        // converted against already-converted Kotlin dependencies (property names, nullability) - the
        // incremental way large codebases are migrated.
        val mode = System.getenv("J2K_MODE") ?: "batch"
        log("mode $mode")
        if (mode == "perfile") {
            val order = readAction { dependencyOrder(files) }
            log("per-file order: ${order.joinToString(" ") { it.name }}")
            val paths = order.map { it.virtualFile.path }
            for ((i, path) in paths.withIndex()) {
                withContext(Dispatchers.Default) { DumbService.getInstance(project).waitForSmartMode() }
                val file = readAction {
                    LocalFileSystem.getInstance().findFileByPath(path)?.let { PsiManager.getInstance(project).findFile(it) as? PsiJavaFile }
                } ?: run { log("  [$i] $path vanished"); null } ?: continue
                val t = System.nanoTime()
                JavaToKotlinActionHandler.convertFiles(listOf(file), project, module, true, false)
                edtWriteAction { FileDocumentManager.getInstance().saveAllDocuments() }
                log("  [${i + 1}/${paths.size}] ${path.substringAfterLast('/')} ${(System.nanoTime() - t) / 1_000_000} ms")
            }
        } else {
            JavaToKotlinActionHandler.convertFiles(
                files,
                project,
                module,
                true, // enableExternalCodeProcessing
                false, // askExternalCodeProcessing: never show a dialog
            )
        }
        edtWriteAction { FileDocumentManager.getInstance().saveAllDocuments() }
        val tConverted = System.nanoTime()
        log("converted in ${(tConverted - tChecked) / 1_000_000} ms")

        val remainingJava = sourceDirs.flatMap { d ->
            Files.walk(projectDir.resolve(d)).use { s -> s.filter { it.toString().endsWith(".java") }.map { projectDir.relativize(it).toString() }.toList() }
        }
        val kotlinFiles = sourceDirs.sumOf { d -> Files.walk(projectDir.resolve(d)).use { s -> s.filter { it.toString().endsWith(".kt") }.count() } }
        log("kotlin files: $kotlinFiles; still java: ${remainingJava.size}")

        fun q(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
        reportPath.writeText(
            """
            {
              "javaFiles": ${files.size},
              "kotlinFiles": $kotlinFiles,
              "remainingJava": [${remainingJava.joinToString(",") { q(it) }}],
              "syntaxErrorFiles": [${syntaxErrors.joinToString(",") { q(it) }}],
              "unresolvedReferences": ${unresolved.size},
              "unresolvedSample": [${unresolved.take(50).joinToString(",") { q(it) }}],
              "msOpenAndIndex": ${(tIndexed - t0) / 1_000_000},
              "msResolveCheck": ${(tChecked - tIndexed) / 1_000_000},
              "msConvert": ${(tConverted - tChecked) / 1_000_000}
            }
            """.trimIndent() + "\n"
        )
        ProjectManagerEx.getInstanceEx().forceCloseProjectAsync(project)
    }

    /**
     * Files ordered so that a file comes after the files it references (depth-first post-order over the
     * reference graph; a cycle is broken where it closes, visiting neighbours in path order so the result
     * is deterministic).
     */
    private fun dependencyOrder(files: List<PsiJavaFile>): List<PsiJavaFile> {
        val set = files.toSet()
        val deps = files.associateWith { f ->
            val out = sortedSetOf<String>()
            val targets = LinkedHashSet<PsiJavaFile>()
            f.accept(object : JavaRecursiveElementWalkingVisitor() {
                override fun visitReferenceElement(reference: PsiJavaCodeReferenceElement) {
                    super.visitReferenceElement(reference)
                    val target = reference.resolve()?.containingFile as? PsiJavaFile ?: return
                    if (target != f && target in set && out.add(target.virtualFile.path)) targets += target
                }
            })
            targets.sortedBy { it.virtualFile.path }
        }
        val done = LinkedHashSet<PsiJavaFile>()
        val onStack = HashSet<PsiJavaFile>()
        fun visit(f: PsiJavaFile) {
            if (f in done || !onStack.add(f)) return
            deps.getValue(f).forEach(::visit)
            onStack.remove(f)
            done += f
        }
        files.sortedBy { it.virtualFile.path }.forEach(::visit)
        return done.toList()
    }

    private fun javaFiles(project: Project, roots: List<VirtualFile>): List<PsiJavaFile> {
        val psi = PsiManager.getInstance(project)
        val out = mutableListOf<PsiJavaFile>()
        for (root in roots) {
            VfsUtilCore.iterateChildrenRecursively(root, null) { vf ->
                if (!vf.isDirectory && vf.extension == "java") (psi.findFile(vf) as? PsiJavaFile)?.let(out::add)
                true
            }
        }
        return out.sortedBy { it.virtualFile.path }
    }

    // Built line by line: an XML file must start exactly at `<?xml` (a first attempt with trimIndent and an
    // interpolated, differently indented block left leading spaces, and IntelliJ loaded an empty module).
    private fun xml(vararg lines: String) = lines.joinToString("\n", postfix = "\n")

    private fun writeProject(dir: Path, sourceDirs: List<String>, stdlib: Path) {
        val d = "$"
        val idea = dir.resolve(".idea").createDirectories()
        idea.resolve("misc.xml").writeText(
            xml(
                """<?xml version="1.0" encoding="UTF-8"?>""",
                """<project version="4">""",
                """  <component name="ProjectRootManager" version="2" languageLevel="JDK_11" project-jdk-name="project-jdk" project-jdk-type="JavaSDK" />""",
                """</project>""",
            )
        )
        idea.resolve("modules.xml").writeText(
            xml(
                """<?xml version="1.0" encoding="UTF-8"?>""",
                """<project version="4">""",
                """  <component name="ProjectModuleManager">""",
                """    <modules>""",
                """      <module fileurl="file://${d}PROJECT_DIR$d/brouter.iml" filepath="${d}PROJECT_DIR$d/brouter.iml" />""",
                """    </modules>""",
                """  </component>""",
                """</project>""",
            )
        )
        dir.resolve("brouter.iml").writeText(
            xml(
                """<?xml version="1.0" encoding="UTF-8"?>""",
                """<module type="JAVA_MODULE" version="4">""",
                """  <component name="NewModuleRootManager" inherit-compiler-output="true">""",
                """    <exclude-output />""",
                """    <content url="file://${d}MODULE_DIR$d">""",
                *sourceDirs.map { """      <sourceFolder url="file://${d}MODULE_DIR$d/$it/java" isTestSource="false" />""" }.toTypedArray(),
                """    </content>""",
                """    <orderEntry type="inheritedJdk" />""",
                """    <orderEntry type="sourceFolder" forTests="false" />""",
                """    <orderEntry type="module-library">""",
                """      <library name="kotlin-stdlib">""",
                """        <CLASSES>""",
                """          <root url="jar://$stdlib!/" />""",
                """        </CLASSES>""",
                """        <JAVADOC />""",
                """        <SOURCES />""",
                """      </library>""",
                """    </orderEntry>""",
                """  </component>""",
                """</module>""",
            )
        )
    }
}
