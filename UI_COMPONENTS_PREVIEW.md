# UI Components Preview

## 🎬 Typing Indicator Component

### Visual Structure:

```
┌─────────────────────────────────────┐
│ [●] [●] [●]  John, Jane đang gõ   │  ← Animated bouncing dots + text
└─────────────────────────────────────┘
```

### Details:

- **Background:** Light gray box with 40% opacity
- **Border:** Subtle 1px border in incoming message color
- **Dots:** 3 animated circles bouncing in sequence
- **Text:** Gray, small font size
- **Animation:** Smooth fade-in when appearing

### Appearance Comparison:

**Light Mode:**

```
┌──────────────────────────────────────────┐
│ ●  ●  ●  Alice, Bob đang gõ             │
│ (Gray box with light gray border)        │
└──────────────────────────────────────────┘
```

**Dark Mode:**

```
┌──────────────────────────────────────────┐
│ ●  ●  ●  Alice, Bob đang gõ             │
│ (Darker gray box with darker border)     │
└──────────────────────────────────────────┘
```

---

## 👥 Seen Status Component

### Visual Structure (Under Message):

#### Case 1: No one has seen yet

```
Message Text
                                          ✓
```

#### Case 2: 1-2 people seen

```
Message Text
                             👤  ✓
```

#### Case 3: 3 people seen

```
Message Text
                      👤 👤 👤  ✓
```

#### Case 4: More than 3 people seen

```
Message Text
                  👤 👤 👤 +5  ✓
```

### Features:

- **Avatars:** Overlapping (-space-x-2), right-aligned
- **Hover:** Each avatar scales up, border changes color
- **Tooltip:** Shows "Username đã xem" on hover
- **Plus Badge:** Shows count of additional viewers
- **Checkmark:** Blue, animated pulse, indicates message sent

### Detailed View:

**Light Mode - Hover State:**

```
┌─────────────────────────┐
│ Alice đã xem            │  ← Tooltip
└──────────┬──────────────┘
           │
      👤  ✓  ← Avatar scales up, border becomes purple
```

**Dark Mode - Hover State:**

```
┌─────────────────────────┐
│ Bob đã xem              │
└──────────┬──────────────┘
           │
      👤  ✓  ← Avatar scales up, border becomes bright purple
```

---

## 🎨 Color Scheme

### Light Mode:

```
Background:      #fafafa (Light gray)
Message In:      #f4f4f5 (Slightly darker gray)
Message Out:     #ede9fe (Light purple)
Text:            #000000 (Black)
Avatar Border:   #fafafa
Hover Border:    #ede9fe
Dots Color:      #a1a1a1 (Medium gray)
Checkmark:       #60a5fa (Blue)
```

### Dark Mode:

```
Background:      #0f0f13 (Very dark)
Message In:      #27272a (Dark gray)
Message Out:     #9810fa (Purple)
Text:            #ffffff (White)
Avatar Border:   #18181b
Hover Border:    #9810fa
Dots Color:      #808080 (Gray)
Checkmark:       #60a5fa (Blue - same as light)
```

---

## 📏 Size Reference

### Avatar:

- Default: 20px × 20px (w-5 h-5)
- Border: 2px
- Stacked: -8px overlap (-space-x-2)

### Typing Dots:

- Single dot: 8px × 8px
- Gap between: 4px
- Bounce height: 4px

### Checkmark:

- Default: 12px × 12px
- Stroke: 3px (bold)
- Animation: Pulse (fade in/out)

### Typing Indicator Container:

- Padding: 12px left/right, 12px top/bottom
- Border radius: 8px (rounded-lg)
- Border: 1px solid

### Plus Badge:

- Size: 20px × 20px (matches avatar)
- Border radius: 50% (circular)
- Font size: 7px (text-[7px])

---

## ⚡ Animation Timings

### Typing Indicator Fade-in:

- Duration: 300ms
- Easing: ease-in-out
- Direction: Fade up 4px

### Avatar Hover Scale:

- Duration: 200ms
- Scale: 1x to 1.1x (10% larger)
- Border color fade: Smooth transition

### Typing Dots Bounce:

- Duration: 600ms (inherent in Tailwind animate-bounce)
- Delay: 0ms, 150ms, 300ms (staggered)
- Height: 4px

### Checkmark Pulse:

- Duration: 2s (inherent in Tailwind animate-pulse)
- Opacity: 1 to 0.5 to 1

---

## 📱 Responsive Breakdown

### Mobile (320px - 640px):

```
All components scale down proportionally
Avatar: 5x5 (same)
Text: xs (12px)
Spacing: Reduced padding
Message container: Full width - 48px
```

### Tablet (640px - 1024px):

```
Components maintain size
More tooltip space
Hover effects visible
Message container: 90% width
```

### Desktop (1024px+):

```
Full styling applied
Optimal hover interactions
Full padding: px-6 py-3
Tooltips positioned perfectly
```

---

## 🔄 State Transitions

### Typing Indicator States:

```
[IDLE]
  ↓ (User starts typing)
[APPEARS] → Fade-in animation
  ↓ (Dots bounce)
[VISIBLE] ← animate-bounce continues
  ↓ (No input for 3 seconds)
[DISAPPEARS] → Fade-out (Redux remove)
  ↓
[IDLE]
```

### Seen Status States:

```
[SENT] → One checkmark
  ↓ (User reads message)
[SEEN] → Avatars + checkmark appear
  ↓ (More users read)
[SEEN - MULTIPLE] → Avatar stack with +N badge
  ↓ (Hover)
[SEEN - TOOLTIP] → Show each user's name
```

---

## 🎯 Interaction Guide

### For Users Sending Messages:

1. **Type message** → See typing indicator in real-time
2. **Send** → Message appears with single checkmark
3. **Others read** → Avatars appear under message
4. **Hover avatars** → See who read and when

### For Users Receiving Messages:

1. **See typing** → "X is typing..." indicator appears
2. **Message arrives** → Full message with sender info
3. **Open conversation** → Your avatar appears under all unread messages
4. **Read all** → Indicates understanding

---

## 🎨 Customization Quick Reference

| Element       | Light       | Dark        | Hover           | File                |
| ------------- | ----------- | ----------- | --------------- | ------------------- |
| Typing BG     | #f4f4f5/40% | #27272a/40% | N/A             | index.css           |
| Typing Border | #f4f4f5/50% | #27272a/50% | N/A             | index.css           |
| Typing Dots   | Gray-400    | Gray-600    | N/A             | TypingIndicator.tsx |
| Avatar Border | #fafafa     | #18181b     | #ede9fe/#9810fa | SeenStatus.tsx      |
| Checkmark     | #60a5fa     | #60a5fa     | pulse           | SeenStatus.tsx      |
| Plus BG       | #ede9fe/20% | #9810fa/20% | scale-110       | SeenStatus.tsx      |

---

**Visual Guide Version:** 1.0
**Last Updated:** April 2, 2026
