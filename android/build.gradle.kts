// Top-level build file — plugin versions are managed in gradle/libs.versions.toml
// 注意：AGP 9.x 自带 Kotlin 支持，不再需要 org.jetbrains.kotlin.android 插件
plugins {
    alias(libs.plugins.android.application) apply false
}
