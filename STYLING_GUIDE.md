# UI/UX Styling Guide - Typing Indicator & Seen Status

Hướng dẫn đầy đủ về các tùy chỉnh giao diện cho tính năng Typing Indicator và Seen Status, sử dụng hệ thống thiết kế hiện có.

## 🎨 Design System Overview

### Color Palette (Light Mode)

```css
--bg-box-chat: #fafafa /* Background chính */ --bg-box-message-incoming: #f4f4f5
  /* Tin nhắn từ người khác */ --bg-box-message-out: #ede9fe
  /* Tin nhắn của mình (tím nhạt) */ --text: #000000 /* Text chính */
  --black-bland: #fafafa /* Header/Footer background */ --button: #d5d7dd
  /* Button secondary color */;
```

### Color Palette (Dark Mode)

```css
--bg-box-chat: #0f0f13 /* Background chính */ --bg-box-message-incoming: #27272a
  /* Tin nhắn từ người khác */ --bg-box-message-out: #9810fa
  /* Tin nhắn của mình (tím) */ --text: #ffffff /* Text chính */
  --black-bland: #18181b /* Header/Footer background */ --button: #3d3d4d
  /* Button secondary color */;
```

## 🎬 Components Created

### 1. TypingIndicator Component

**Location:** `frontend/src/components/TypingIndicator/TypingIndicator.tsx`

#### Features:

- ✅ Animated dots that bounce in sequence
- ✅ Displays user names who are typing
- ✅ Fade-in animation on appearance
- ✅ Respects light/dark theme
- ✅ Only shows when users are actually typing

#### Styling Details:

```tsx
<div className="flex items-center gap-2 px-4 py-3 rounded-lg
                bg-bg-box-message-incoming/40    /* 40% opacity of incoming message color */
                border border-bg-box-message-incoming/50  /* 50% opacity border */
                animate-fade-in">                /* Custom fade-in animation */
```

**Colors by Theme:**
| Theme | Background | Border | Dots |
|-------|-----------|--------|------|
| Light | #f4f4f5 (40% opacity) | #f4f4f5 (50% opacity) | Gray (#a1a1a1) |
| Dark | #27272a (40% opacity) | #27272a (50% opacity) | Gray (#808080) |

#### Animated Dots:

- 3 dots with staggered bounce animation
- Delays: 0ms, 150ms, 300ms
- Uses built-in `animate-bounce` from Tailwind

#### Usage:

```tsx
<TypingIndicator userNames={["John", "Jane"]} />
// Outputs: "John, Jane đang gõ" with animated dots
```

---

### 2. SeenStatus Component

**Location:** `frontend/src/components/SeenStatus/SeenStatus.tsx`

#### Features:

- ✅ Displays avatars of users who have seen the message
- ✅ Shows "+N" indicator for more than 3 users
- ✅ Tooltip on hover showing username
- ✅ Blue animated checkmark indicator
- ✅ Stacked avatar layout (overlapping)
- ✅ Hover animation (scale + border color change)

#### Styling Details:

**Avatar Stack:**

```tsx
<div className="flex -space-x-2">  /* Negative space to overlap avatars */
  {seenUsers.slice(0, 3).map(user => (
    <Avatar className="w-5 h-5
                       border-2 border-bg-box-chat  /* Match background */
                       hover:border-bg-box-message-out  /* Change on hover */
                       hover:scale-110
                       transform duration-200">
```

**Avatar Styling:**

- Size: 5x5 (20px)
- Border: 2px solid background color
- Hover: Scales up to 110%, changes border to message-out color
- Transition: 200ms smooth duration

**Plus Indicator (for 3+ users):**

```tsx
<div
  className="w-5 h-5 rounded-full 
                bg-bg-box-message-out/20  /* 20% opacity of send message color */
                border-2 border-bg-box-chat"
>
  <span className="text-[7px] font-bold text-gray-600">+{count}</span>
</div>
```

**Checkmark:**

- Color: Blue (#60a5fa)
- Animation: `animate-pulse` (gentle fade in/out)
- Size: w-3 h-3
- Stroke: 3px (bold)

**Tooltip Styling:**

```tsx
<TooltipContent
  className="text-xs
             bg-black-bland        /* Use header background */
             text-text             /* Use text color */
             border border-bg-box-message-incoming">
```

#### Theme Adaptation:

| Element       | Light         | Dark          |
| ------------- | ------------- | ------------- |
| Avatar Border | #fafafa       | #18181b       |
| Hover Border  | #ede9fe       | #9810fa       |
| Plus BG       | #ede9fe (20%) | #9810fa (20%) |
| Text in Plus  | #4b5563       | #808080       |

#### Usage:

```tsx
<SeenStatus
  seenUsers={[
    { userId: "1", username: "Alice", avatar: "url" },
    { userId: "2", username: "Bob", avatar: "url" },
  ]}
/>
// Shows two avatars + blue checkmark
```

---

## 🎬 Animations

### Custom Keyframe Animations

**File:** `frontend/src/index.css`

#### fadeIn Animation

```css
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px); /* Slide up from -4px */
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-in {
  animation: fadeIn 0.3s ease-in-out;
}
```

**Usage:** Typing indicator appears with fade-in effect

#### slideInUp Animation (可选)

```css
@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-slide-in-up {
  animation: slideInUp 0.3s ease-in-out;
}
```

### Built-in Tailwind Animations Used

- `animate-bounce` - Typing indicator dots
- `animate-pulse` - Checkmark fade in/out

---

## 🎨 Color Customization

### Method 1: Change CSS Variables (Recommended)

Edit `frontend/src/index.css` color definitions:

```css
:root {
  /* Light mode */
  --bg-box-message-incoming: #f4f4f5; /* Change this */
  --bg-box-message-out: #ede9fe;
}

.dark {
  /* Dark mode */
  --bg-box-message-incoming: #27272a; /* Change this */
  --bg-box-message-out: #9810fa;
}
```

### Method 2: Component-level Customization

Edit component files directly:

**TypingIndicator.tsx:**

```tsx
// Change background opacity
bg-bg-box-message-incoming/40  →  bg-bg-box-message-incoming/60

// Change dot color
bg-gray-400  →  bg-blue-400

// Change text color
text-gray-500  →  text-gray-600
```

**SeenStatus.tsx:**

```tsx
// Change hover color
hover:border-bg-box-message-out  →  hover:border-blue-500

// Change checkmark color
text-blue-400  →  text-blue-500

// Change avatar size
w-5 h-5  →  w-6 h-6
```

---

## 📐 Layout Integration

### In ChatWindow Component

**Location:** `frontend/src/components/ChatWindow/index.tsx`

#### Typing Indicator Placement:

```tsx
<div className="flex-1 overflow-y-auto p-6 space-y-4">
  <MessageComponent messages={messages} seenMessages={seenMessages} />

  {/* Positioned after messages, shows when users are typing */}
  <TypingIndicator userNames={typingUserNames} />

  <div ref={bottomRef} />
</div>
```

**Why this placement:**

- Appears just before the scroll anchor
- Auto-scrolls to bottom when typing indicator appears
- Looks natural within message stream

#### Spacing:

- Messages: `space-y-4` (16px gap between messages)
- Indicator: `px-4 py-3` (4px left/right, 3px top/bottom)
- Margin: Inherited from space-y-4

---

### In Messages Component

**Location:** `frontend/src/components/ChatWindow/Messages.tsx`

#### Seen Status Placement:

```tsx
{
  isMine && !isSameAsNext && (
    <SeenStatus
      seenUsers={seenMessages[message.id] || []}
      messageStatus={message?.status}
    />
  );
}
```

**Conditions for showing:**

- `isMine`: Only show on own messages
- `!isSameAsNext`: Only show for last message in group (prevents duplicate indicators)

**Positioning:**

```tsx
<div className="flex justify-end mr-10">  /* Right-aligned, 40px margin from right */
  <SeenStatus ... />
</div>
```

---

## 📱 Responsive Design

Both components are responsive and work on all screen sizes:

### Mobile (< 640px)

- Avatar size: 5x5 (20px) - stays same
- Gap between elements: Maintained via px/py spacing
- Text size: text-xs (12px) - fitting for small screens
- Typing dots: Same size

### Tablet (640px - 1024px)

- All styling scales naturally
- Flex layout adapts automatically

### Desktop (> 1024px)

- Full-width message container (p-6 padding)
- Hover effects fully visible
- Tooltip positioning optimized

---

## 🌓 Dark Mode Support

All components automatically support dark mode via CSS variables.

### Example Color Transitions:

**Typing Indicator Typing Indicator Background:**

- Light: `#f4f4f5` (light gray)
- Dark: `#27272a` (dark gray)

**Avatar Border:**

- Light: `#fafafa` (very light)
- Dark: `#18181b` (very dark)

### Testing Dark Mode:

```html
<!-- Add to HTML root: -->
<html class="dark">
  <!-- or remove for light mode -->
</html>
```

---

## 🔧 Advanced Customization

### Typing Indicator Timeout

**File:** `frontend/src/hooks/useTypingIndicator.ts`

```tsx
// Change 3-second timeout to different value
setTimeout(() => {
  stopTyping();
}, 3000); // ← Change this value (ms)
```

### Avatar Limit

**File:** `frontend/src/components/SeenStatus/SeenStatus.tsx`

```tsx
{seenUsers.slice(0, 3).map(user => (  // ← Change 3 to show more/fewer avatars
```

### Animation Speed

**File:** `frontend/src/index.css`

```css
@keyframes fadeIn {
  /* ... */
}

.animate-fade-in {
  animation: fadeIn 0.3s ease-in-out; /* ← Change 0.3s for faster/slower */
}
```

### Bounce Speed (Typing Dots)

Tailwind's `animate-bounce` has fixed duration, to customize:

```css
@keyframes bounce-custom {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}

.animate-bounce-custom {
  animation: bounce-custom 0.6s infinite; /* ← Adjust duration */
}
```

---

## 📦 Component File Structure

```
frontend/src/components/
├── TypingIndicator/
│   ├── TypingIndicator.tsx     /* Main component */
│   └── index.ts                /* Export barrel */
├── SeenStatus/
│   ├── SeenStatus.tsx          /* Main component */
│   └── index.ts                /* Export barrel */
├── ChatWindow/
│   ├── index.tsx               /* Main chat window */
│   ├── Messages.tsx            /* Message list */
│   └── ...
└── ui/
    ├── tooltip.tsx             /* Reusable tooltip */
    ├── avatar.tsx              /* Reusable avatar */
    └── ...
```

---

## ✨ Best Practices

### 1. Performance

✅ Typing indicator only renders when users are typing
✅ Seen status uses memoization via Redux
✅ Animations use GPU acceleration (transform, opacity)

### 2. Accessibility

✅ Avatars have fallback initials
✅ Tooltips provide context
✅ Icons use semantic sizing
✅ Color not the only indicator (checkmark present)

### 3. User Experience

✅ Smooth animations don't feel jarring
✅ Clear visual indicators for actions
✅ Consistent with existing design
✅ Dark mode fully supported

---

## 🎯 Testing UI/UX

### Test Typing Indicator:

1. Open 2 browser tabs with different users
2. Start typing in one tab
3. Verify: Other tab shows animated "X đang gõ..."
4. Wait 3 seconds without typing
5. Verify: Indicator disappears

### Test Seen Status:

1. User A sends message
2. User B opens conversation
3. Verify: User A sees avatars + checkmark under message
4. Hover over avatars
5. Verify: Tooltip shows "Username đã xem"

### Test Dark Mode:

1. Toggle theme in app
2. Verify: All colors adapt automatically
3. Check contrast ratios are sufficient

---

## 📚 Related Files

**Styling & Theme:**

- `frontend/src/index.css` - Color variables & animations

**Components:**

- `frontend/src/components/TypingIndicator/TypingIndicator.tsx`
- `frontend/src/components/SeenStatus/SeenStatus.tsx`

**Integration:**

- `frontend/src/components/ChatWindow/index.tsx` - Uses TypingIndicator
- `frontend/src/components/ChatWindow/Messages.tsx` - Uses SeenStatus

**Logic:**

- `frontend/src/redux/slices/typingIndicatorSlice.ts` - State management
- `frontend/src/redux/slices/seenStatusSlice.ts` - State management

---

## 🚀 Future Enhancements

Các cải tiến có thể thêm trong tương lai:

1. **Typing sound** - Play subtle ping when someone starts typing
2. **Animated avatars** - Avatar circles could pulse when typing
3. **Read receipts breakdown** - Show timestamp of when each user read
4. **Read animation** - Animate checkmark when message transitions to "seen"
5. **Custom typing message** - "X bắt đầu chỉnh sửa..." for edit mode
6. **Disable animations** - Option for users who prefer motion-reduced
7. **Toast notifications** - Notify when in different conversation
8. **Seen indicator on sidebar** - Show conversation has unread messages

---

**Version:** 1.0.0 - UI/UX Styling
**Last Updated:** April 2, 2026
**Theme Support:** Light & Dark Mode ✅
**Responsive:** Mobile, Tablet, Desktop ✅
**Accessibility:** WCAG compatible ✅
