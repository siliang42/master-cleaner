#!/usr/bin/env swift
//
// Builds the macOS menu-bar (tray) template images from the app logo.
//
// A template image is pure black + alpha; macOS then renders it correctly on
// light and dark menu bars. The logo artwork is a dark rounded square with a
// bright "M" mark, so we mask by luminance: bright pixels (the mark) stay,
// the dark background becomes transparent.
//
// Output: electron/assets/trayTemplate.png (18px) and trayTemplate@2x.png (36px).
// Run from the repository root:  swift scripts/make-tray-icon.swift
//

import AppKit
import CoreGraphics
import Foundation

let repo = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let source = repo.appendingPathComponent("web/logo-square.png")
let outDir = repo.appendingPathComponent("electron/assets")

try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

guard let image = NSImage(contentsOf: source),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fatalError("cannot read \(source.path)")
}

func templateImage(size: Int) -> CGImage {
    let space = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: size * 4,
        space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        fatalError("cannot create bitmap context")
    }
    ctx.interpolationQuality = .high
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: size, height: size))

    guard let data = ctx.data else { fatalError("no bitmap data") }
    let px = data.bindMemory(to: UInt8.self, capacity: size * size * 4)
    for i in 0..<(size * size) {
        let o = i * 4
        let r = Double(px[o])
        let g = Double(px[o + 1])
        let b = Double(px[o + 2])
        let a = Double(px[o + 3]) / 255.0
        let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        // Keep the bright artwork, fade the dark rounded-square background.
        let coverage = max(0.0, min(1.0, (lum - 55.0) / 120.0)) * a
        px[o] = 0
        px[o + 1] = 0
        px[o + 2] = 0
        px[o + 3] = UInt8(coverage * 255.0)
    }
    guard let out = ctx.makeImage() else { fatalError("cannot build image") }
    return out
}

func write(_ image: CGImage, _ name: String) {
    let rep = NSBitmapImageRep(cgImage: image)
    guard let data = rep.representation(using: .png, properties: [:]) else {
        fatalError("PNG encoding failed for \(name)")
    }
    let url = outDir.appendingPathComponent(name)
    try! data.write(to: url)
    print("wrote \(url.path)")
}

write(templateImage(size: 18), "trayTemplate.png")
write(templateImage(size: 36), "trayTemplate@2x.png")
