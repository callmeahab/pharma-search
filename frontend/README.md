# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/e4a85829-b929-42e6-8d58-ec74d89f7d6b

## API Integration

This frontend integrates with a backend API for real product search functionality.

### Environment Setup

Create a `.env.local` file in the frontend directory:

```bash
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:8000

# Environment
NODE_ENV=development
```

### Backend Requirements

Make sure the backend API is running on `http://localhost:8000` before starting the frontend. The application will fall back to sample data if the API is not available.

### Search Functionality

- **Search Bar Dropdown**: Shows real product groups from API with pricing information
- **Without search terms**: Shows sample products with category filtering
- **With search terms**: Uses real backend API to search pharmaceutical products and displays them as individual product cards
- **API unavailable**: Automatically falls back to sample data filtering

### New Features

- **Smart Search Dropdown**: Displays actual product groups from the backend API with pricing
- **Product Cards**: Search results are displayed as individual product cards instead of grouped view
- **Real-time Search**: API calls with debouncing for optimal performance
- **Fallback Support**: Graceful degradation when API is unavailable
- **Title Humanization**: Automatically converts lowercase API titles to proper title case with pharmaceutical-specific formatting
  - Example: "vitamin d3 2000 iu" → "Vitamin D3 2000 IU"
  - Handles special cases for pharmaceutical abbreviations (MG, MCG, IU, etc.)
- **Currency Formatting**: All prices displayed in Serbian Dinar (RSD) with proper localization
  - Consistent formatting across all components using `formatPrice()` utility
  - Serbian locale number formatting for better regional experience

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/e4a85829-b929-42e6-8d58-ec74d89f7d6b) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/e4a85829-b929-42e6-8d58-ec74d89f7d6b) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes it is!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/tips-tricks/custom-domain#step-by-step-guide)
