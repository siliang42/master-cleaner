// Renders the monochrome Master Cleaner mark to build/icon.png with a genuinely
// transparent background. Quick Look (qlmanage) draws SVG on an opaque white
// backdrop, so the geometry from build/icon-mono.svg is stroked directly here.
//
// Usage: swift scripts/render-app-icon.swift

import AppKit
import ImageIO

let repoRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let output = repoRoot.appendingPathComponent("build/icon.png")

let size = 1024
guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                          space: CGColorSpaceCreateDeviceRGB(),
                          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
  fatalError("could not create the bitmap context")
}
ctx.setAllowsAntialiasing(true)
ctx.setShouldAntialias(true)
ctx.setStrokeColor(CGColor(srgbRed: 0x10 / 255.0, green: 0x11 / 255.0, blue: 0x14 / 255.0, alpha: 1))
ctx.setLineWidth(116)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)

// Same coordinates as build/icon-mono.svg (1024 viewBox), y flipped for CoreGraphics.
func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: CGFloat(size) - y) }
let path = CGMutablePath()
path.move(to: p(214, 738))
path.addLine(to: p(214, 222))
path.addLine(to: p(512, 624))
path.addLine(to: p(810, 222))
path.addLine(to: p(810, 738))
ctx.addPath(path)
ctx.strokePath()

guard let image = ctx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(output as CFURL, "public.png" as CFString, 1, nil) else {
  fatalError("could not encode the icon")
}
CGImageDestinationAddImage(dest, image, nil)
guard CGImageDestinationFinalize(dest) else { fatalError("could not write \(output.path)") }
print("wrote \(output.path)")
