# JSON ScriptableObject Inspector Extension for Cocos Creator 3.8

This extension provides a **Unity ScriptableObject-style Visual Inspector** for all `.json` assets in Cocos Creator 3.8.8+.

## Key Features

1. **Visual Form Editor (ScriptableObject Tree)**:
   - Form-based property rendering with typed inputs (Text, Numbers with step controls, Checkboxes, Dropdowns).
   - Collapsible hierarchical sections for `CTA`, `Audio`, `Gameplay`, `Camera`, `Hero`, `Tracking`, and `Custom` settings.
   - Array list management (Add item, Delete item, Reorder).
   - URL validation and quick "🔗 Test" button to open store links in browser.

2. **Direct Save Capabilities**:
   - Prominent **💾 Save (Ctrl+S)** button directly on the Inspector header.
   - Saves modified content to disk and triggers Cocos Creator AssetDB reimport automatically.
   - Status badge indicating `Saved` (clean) vs `● Modified` (unsaved).

3. **Dual View Modes**:
   - Toggle seamlessly between **Visual Form Mode** and **Raw Code Mode** (with syntax check and formatting).

4. **Zero-Scene-Tweak Architecture**:
   - Developers and AI agents only need to configure parameters in `assets/resources/playable-config.json`.
   - All gameplay code reads directly from `PlayableConfigManager.instance`.
