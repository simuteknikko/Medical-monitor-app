## About Me

My name is **Henry Alatyppö**, and I work as a **Simulation Technician** at Helsinki University Hospital.

I started this project to provide a **free, simple, and accessible patient monitor simulation tool**. Through my work, I’ve seen a growing need for lightweight solutions that focus on practical use rather than complex, costly ecosystems. Many existing tools are powerful, but they can be difficult to access or overbuilt for everyday training needs. This project aims to offer a clear, focused alternative that prioritizes usability and openness.

You can run the monitor application at **https://medicalmonitorsim.com**.  
The app is **completely free**, and I intend to keep it that way.  
It is released under the **GPL 3.0 license**.

**Copyright © 2026 Henry Alatyppö**

## Support the Project

This application runs on a **VPS with ongoing monthly costs**.  
If you find this app useful and valuable for your work, education, or training, please consider supporting its **development and continued availability**.

Support helps cover:
- Server and infrastructure costs
- Ongoing maintenance
- Further development and improvements

You can support the project via **GitHub Sponsors**.  
Every contribution, no matter the size, is greatly appreciated.

## Monitor Modes

The application offers two flexible operating modes to suit different training scenarios and equipment setups.

---

### 🖥️ Standalone Mode

**Best for: Quick demonstrations, single-user training, or testing**

In Standalone Mode, both the **monitor display** and **control panel** run together on the same device and browser window.

**How it works:**
1. Open the application on your device
2. Use the built-in controller to adjust vital signs (heart rate, blood pressure, SpO2, etc.)
3. Click **"Update Vitals Monitor"** to apply changes
4. The monitor display updates instantly to reflect the new values

**Advantages:**
- Simple setup — no additional devices required
- Perfect for quick testing and individual practice
- Ideal for demonstrations on a single screen

### 📱 Multi-Device Mode

**Best for: Realistic simulation environments, classroom training, and multi-user scenarios**

Multi-Device Mode separates the **monitor display** from the **controller**, allowing you to run them on different devices simultaneously. This eliminates the need for dedicated or proprietary simulation hardware.

**How it works:**
1. **Display Device:** Open the monitor view on a laptop, tablet, large screen, or projector
2. **Controller Device:** Open the control panel on a smartphone, tablet, or another computer
3. Both devices connect via a **shared session ID** or QR code
4. Changes made on the controller instantly appear on the monitor display in real time

**Use Cases:**
- **Simulation Lab Setup:** Display the monitor on a large screen positioned above a manikin, while an instructor controls parameters from a tablet or smartphone
- **Classroom Training:** Project the monitor for all students to see, while the instructor adjusts vitals from their device
- **Remote Teaching:** Share the monitor screen via video conference while controlling it from another device
- **Team-Based Scenarios:** One person acts as the "patient" with vitals displayed, while another controls the parameters remotely
- **Custom Scenario Development:** Create and save your own clinical cases with predefined vital signs for standardized training exercises

**Create Your Own Cases:**

Build custom simulation scenarios tailored to your specific training needs. You can:
- **Design Patient Scenarios:** Set up specific vital sign patterns for different clinical conditions (e.g., septic shock, myocardial infarction, respiratory distress)
- **Save Case Presets:** Store commonly used parameter combinations for quick access during training sessions
- **Progressive Cases:** Create multi-stage scenarios where vitals change over time to simulate patient deterioration or improvement
- **Standardized Training:** Ensure all learners experience identical cases for fair assessment and consistent education
- **Share Cases:** Export and share your custom scenarios with colleagues or across your institution

**Case Management & Storage:**

Cases are stored as **JSON files** (JavaScript Object Notation), making them lightweight, human-readable, and easy to manage.

- **Local Storage:** Cases are automatically saved to your browser's local storage, allowing quick access without requiring an internet connection or external database
- **Download Cases:** Export any case as a JSON file to your device for backup or offline storage
- **Upload Cases:** Import JSON case files from your device or colleagues to expand your scenario library
- **Share Cases:** Easily distribute case files via email, shared drives, or collaboration platforms
- **Version Control:** Keep multiple versions of scenarios for different learning levels or curriculum updates
- **Privacy-Focused:** All data remains on your device unless you explicitly choose to share it

**Example Use:**  
An instructor creates a "Cardiac Arrest" scenario, downloads the JSON file, and shares it with colleagues at other institutions. They can import it and run the identical scenario in their own training sessions.

This feature allows instructors and simulation coordinators to prepare training materials in advance, reducing setup time and ensuring educational objectives are met consistently.

**Advantages:**
- **Cost-effective:** Use existing devices instead of purchasing expensive proprietary simulation equipment
- **Flexible:** Works with smartphones, tablets, laptops, or any device with a modern web browser
- **Portable:** No need for dedicated controllers or specialized hardware
- **Scalable:** Easily add or remove devices as needed for different training setups
- **Accessible:** Compatible with iOS, Android, Windows, macOS, and Linux because the app works in the browser
- **Customizable:** Build your own library of clinical scenarios for targeted training
- **Privacy-Conscious:** Your case data stays on your device unless you choose to share it

**Technical Requirements:**
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Stable internet connection (for cloud-hosted version) or local network (for self-hosted deployments)
- No special software installation required

---

**Not sure which mode to use?**  
Start with **Standalone Mode** to familiarize yourself with the application, then explore **Multi-Device Mode** when you need more flexibility or want to create a more immersive training environment.
