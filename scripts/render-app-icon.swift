// Renders the Master Cleaner app icon (build/icon.png) used by the Dock and
// Launchpad. The wordmark keeps the original "Master Cleaner" lockup, rebuilt
// with a brushed-metal shell, a polished silver wordmark and a glowing teal
// brush stroke.
//
// Usage: swift scripts/render-app-icon.swift

import AppKit
import CoreGraphics
import CoreText
import ImageIO

let repoRoot = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let outputURL = repoRoot.appendingPathComponent("build/icon.png")

let logical = 1024
let scale = 2
let pixels = logical * scale
let rect = CGRect(x: 0, y: 0, width: CGFloat(logical), height: CGFloat(logical))
let space = CGColorSpaceCreateDeviceRGB()

func rgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: r / 255.0, green: g / 255.0, blue: b / 255.0, alpha: a)
}

func gradient(_ stops: [(CGColor, CGFloat)]) -> CGGradient {
    CGGradient(colorsSpace: space, colors: stops.map { $0.0 } as CFArray, locations: stops.map { $0.1 })!
}

guard let ctx = CGContext(
    data: nil,
    width: pixels,
    height: pixels,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: space,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fatalError("could not create the bitmap context")
}
ctx.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
ctx.setAllowsAntialiasing(true)
ctx.setShouldAntialias(true)
ctx.interpolationQuality = .high

let shell = CGPath(
    roundedRect: rect,
    cornerWidth: 228,
    cornerHeight: 228,
    transform: nil
)

// MARK: - Brushed-metal shell

ctx.saveGState()
ctx.addPath(shell)
ctx.clip()

let base = gradient([
    (rgb(7, 11, 15), 0.0),
    (rgb(15, 24, 32), 0.42),
    (rgb(27, 43, 55), 0.76),
    (rgb(48, 69, 84), 1.0),
])
ctx.drawLinearGradient(base, start: CGPoint(x: 120, y: 30), end: CGPoint(x: 940, y: 1000), options: [])

// Cool teal reflection rising from the bottom edge.
let bottomGlow = gradient([
    (rgb(45, 212, 191, 0.17), 0.0),
    (rgb(45, 212, 191, 0.0), 1.0),
])
ctx.drawRadialGradient(
    bottomGlow,
    startCenter: CGPoint(x: 500, y: 210),
    startRadius: 0,
    endCenter: CGPoint(x: 500, y: 210),
    endRadius: 620,
    options: []
)

// Fine diagonal brushing.
ctx.setLineWidth(1)
for i in stride(from: -500, through: 1500, by: 10) {
    ctx.setStrokeColor(i % 20 == 0 ? rgb(255, 255, 255, 0.030) : rgb(2, 6, 9, 0.042))
    ctx.move(to: CGPoint(x: CGFloat(i), y: -220))
    ctx.addLine(to: CGPoint(x: CGFloat(i) + 920, y: 1240))
    ctx.strokePath()
}

// Soft sheen along the top.
let sheen = gradient([
    (rgb(255, 255, 255, 0.17), 0.0),
    (rgb(255, 255, 255, 0.06), 0.42),
    (rgb(255, 255, 255, 0.0), 1.0),
])
ctx.drawRadialGradient(
    sheen,
    startCenter: CGPoint(x: 500, y: 930),
    startRadius: 0,
    endCenter: CGPoint(x: 500, y: 930),
    endRadius: 800,
    options: []
)

let cornerSheen = gradient([
    (rgb(255, 255, 255, 0.11), 0.0),
    (rgb(255, 255, 255, 0.0), 1.0),
])
ctx.drawRadialGradient(
    cornerSheen,
    startCenter: CGPoint(x: 250, y: 880),
    startRadius: 0,
    endCenter: CGPoint(x: 250, y: 880),
    endRadius: 430,
    options: []
)

ctx.restoreGState()

// Thin polished rim, brighter at the top.
ctx.saveGState()
ctx.addPath(CGPath(
    roundedRect: rect.insetBy(dx: 7, dy: 7),
    cornerWidth: 221,
    cornerHeight: 221,
    transform: nil
))
ctx.setLineWidth(2)
ctx.replacePathWithStrokedPath()
ctx.clip()
let rim = gradient([
    (rgb(255, 255, 255, 0.52), 0.0),
    (rgb(230, 240, 248, 0.18), 0.46),
    (rgb(120, 140, 156, 0.30), 0.78),
    (rgb(255, 255, 255, 0.42), 1.0),
])
ctx.drawLinearGradient(rim, start: CGPoint(x: 512, y: 0), end: CGPoint(x: 512, y: 1024), options: [])
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(shell)
ctx.setLineWidth(2.5)
ctx.setStrokeColor(rgb(255, 255, 255, 0.16))
ctx.strokePath()
ctx.restoreGState()

// MARK: - Glowing teal brush stroke

func brushPath() -> CGPath {
    let p = CGMutablePath()
    p.move(to: CGPoint(x: 262, y: 660))
    p.addCurve(
        to: CGPoint(x: 300, y: 428),
        control1: CGPoint(x: 205, y: 560),
        control2: CGPoint(x: 228, y: 438)
    )
    p.addCurve(
        to: CGPoint(x: 752, y: 420),
        control1: CGPoint(x: 424, y: 394),
        control2: CGPoint(x: 638, y: 396)
    )
    p.addCurve(
        to: CGPoint(x: 804, y: 452),
        control1: CGPoint(x: 776, y: 414),
        control2: CGPoint(x: 798, y: 432)
    )
    return p
}

func strokeWithGradient(
    _ path: CGPath,
    width: CGFloat,
    gradient fill: CGGradient,
    from: CGPoint,
    to: CGPoint
) {
    ctx.saveGState()
    ctx.addPath(path)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.setLineWidth(width)
    ctx.replacePathWithStrokedPath()
    ctx.clip()
    ctx.drawLinearGradient(fill, start: from, end: to, options: [])
    ctx.restoreGState()
}

let stroke = brushPath()

// Neon bloom underneath the stroke.
ctx.saveGState()
ctx.setShadow(offset: .zero, blur: 30, color: rgb(45, 212, 191, 0.38))
ctx.addPath(stroke)
ctx.setLineCap(.round)
ctx.setLineWidth(36)
ctx.setStrokeColor(rgb(45, 212, 191, 0.38))
ctx.strokePath()
ctx.restoreGState()

strokeWithGradient(
    stroke,
    width: 36,
    gradient: gradient([
        (rgb(10, 112, 105), 0.0),
        (rgb(20, 184, 166), 0.45),
        (rgb(94, 234, 212), 0.82),
        (rgb(196, 255, 247), 1.0),
    ]),
    from: CGPoint(x: 228, y: 370),
    to: CGPoint(x: 820, y: 520)
)

// Mirror highlight along the upper edge of the brush.
strokeWithGradient(
    stroke,
    width: 7,
    gradient: gradient([
        (rgb(255, 255, 255, 0.0), 0.0),
        (rgb(255, 255, 255, 0.55), 0.5),
        (rgb(255, 255, 255, 0.9), 1.0),
    ]),
    from: CGPoint(x: 300, y: 470),
    to: CGPoint(x: 800, y: 520)
)

// MARK: - Polished silver wordmark

func textMask(_ text: String, fontSize: CGFloat, x: CGFloat, baseline: CGFloat) -> CGImage {
    let gray = CGColorSpaceCreateDeviceGray()
    guard let mctx = CGContext(
        data: nil,
        width: pixels,
        height: pixels,
        bitsPerComponent: 8,
        bytesPerRow: pixels,
        space: gray,
        bitmapInfo: CGImageAlphaInfo.none.rawValue
    ) else {
        fatalError("could not create the text mask")
    }
    mctx.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    mctx.setAllowsAntialiasing(true)
    mctx.setShouldAntialias(true)
    mctx.setFillColor(CGColor(gray: 0, alpha: 1))
    mctx.fill(rect)
    mctx.setFillColor(CGColor(gray: 1, alpha: 1))

    let font = CTFontCreateWithName("HelveticaNeue-Bold" as CFString, fontSize, nil)
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor.white,
    ]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
    mctx.textPosition = CGPoint(x: x, y: baseline)
    CTLineDraw(line, mctx)
    guard let image = mctx.makeImage() else { fatalError("could not build the text mask") }
    return image
}

func drawMask(_ mask: CGImage, color: CGColor, offset: CGSize = .zero) {
    ctx.saveGState()
    ctx.translateBy(x: offset.width, y: offset.height)
    ctx.clip(to: rect, mask: mask)
    ctx.setFillColor(color)
    ctx.fill(rect)
    ctx.restoreGState()
}

func drawMaskedGradient(_ mask: CGImage, stops: [(CGColor, CGFloat)], from: CGPoint, to: CGPoint) {
    ctx.saveGState()
    ctx.clip(to: rect, mask: mask)
    ctx.drawLinearGradient(gradient(stops), start: from, end: to, options: [])
    ctx.restoreGState()
}

let master = textMask("Master", fontSize: 156, x: 278, baseline: 606)
let cleaner = textMask("Cleaner", fontSize: 156, x: 348, baseline: 438)

// Warm teal bloom behind the wordmark.
let wordGlow = gradient([
    (rgb(45, 212, 191, 0.10), 0.0),
    (rgb(45, 212, 191, 0.0), 1.0),
])
ctx.drawRadialGradient(
    wordGlow,
    startCenter: CGPoint(x: 520, y: 520),
    startRadius: 0,
    endCenter: CGPoint(x: 520, y: 520),
    endRadius: 460,
    options: []
)

let metal: [(CGColor, CGFloat)] = [
    (rgb(62, 73, 85), 0.0),
    (rgb(140, 152, 166), 0.30),
    (rgb(225, 233, 242), 0.65),
    (rgb(255, 255, 255), 0.88),
    (rgb(240, 246, 252), 1.0),
]

for mask in [master, cleaner] {
    drawMask(mask, color: rgb(0, 0, 0, 0.24), offset: CGSize(width: 0, height: -6))
    drawMaskedGradient(mask, stops: metal, from: CGPoint(x: 512, y: 300), to: CGPoint(x: 512, y: 800))
}

// Crisp top reflection on the wordmark.
for (mask, top, bottom) in [(master, CGFloat(718), CGFloat(606)), (cleaner, CGFloat(550), CGFloat(438))] {
    drawMaskedGradient(
        mask,
        stops: [
            (rgb(255, 255, 255, 0.0), 0.0),
            (rgb(255, 255, 255, 0.40), 0.18),
            (rgb(255, 255, 255, 0.0), 0.50),
        ],
        from: CGPoint(x: 512, y: bottom),
        to: CGPoint(x: 512, y: top)
    )
}

// MARK: - Export

ctx.addPath(shell)
ctx.setLineWidth(1)
ctx.setStrokeColor(rgb(255, 255, 255, 0.08))
ctx.strokePath()

guard let large = ctx.makeImage() else { fatalError("could not render the icon") }
guard let outCtx = CGContext(
    data: nil,
    width: logical,
    height: logical,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: space,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fatalError("could not create the output context")
}
outCtx.interpolationQuality = .high
outCtx.draw(large, in: CGRect(x: 0, y: 0, width: logical, height: logical))
guard let final = outCtx.makeImage(),
      let dest = CGImageDestinationCreateWithURL(outputURL as CFURL, "public.png" as CFString, 1, nil) else {
    fatalError("could not encode the icon")
}
CGImageDestinationAddImage(dest, final, nil)
guard CGImageDestinationFinalize(dest) else { fatalError("could not write \(outputURL.path)") }
print("wrote \(outputURL.path)")
