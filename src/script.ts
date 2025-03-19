// Extend Window interface to include our logout function
declare global {
    interface Window {
        logout: () => void;
    }
}

const clientId = "1fd1e055d2704f3bbec35e869034d71b"; // Replace with your client id
const params = new URLSearchParams(window.location.search);
const code = params.get("code");
// const redirectUri = "http://127.0.0.1:5173/callback"; // e.g., http://localhost:3000/callback
const scopes = [
  "user-read-private", 
  "user-read-email", 
  "playlist-read-private", 
  "playlist-read-collaborative"
];

// Store the token information
interface TokenInfo {
    access_token: string;
    expires_at: number; // Timestamp when token expires
}

async function init() {
    // Check if we're coming back from Spotify auth
    if (code) {
        // If redirected with code, get the token
        const accessToken = await getAccessToken(clientId, code);
        
        // Store token with expiration (Spotify tokens typically expire in 1 hour)
        const expiresAt = Date.now() + 3600 * 1000; // Current time + 1 hour in milliseconds
        const tokenInfo: TokenInfo = {
            access_token: accessToken,
            expires_at: expiresAt
        };
        
        localStorage.setItem("spotify_token_info", JSON.stringify(tokenInfo));
        
        // Clear the code from URL so refreshing doesn't attempt to use old code
        window.history.replaceState({}, document.title, "/");
        
        // Proceed with using the new token
        await loadUserData(accessToken);
    } else {
        // No code, check for stored token
        const storedTokenInfo = localStorage.getItem("spotify_token_info");
        
        if (storedTokenInfo) {
            const tokenInfo: TokenInfo = JSON.parse(storedTokenInfo);
            
            // Check if token is still valid (with 5 min buffer)
            if (tokenInfo.expires_at > Date.now() + 5 * 60 * 1000) {
                // Token is still valid, use it
                await loadUserData(tokenInfo.access_token);
                return;
            } else {
                // Token expired, clear it
                localStorage.removeItem("spotify_token_info");
            }
        }
        
        // No valid token, redirect to auth flow
        redirectToAuthCodeFlow(clientId);
    }
}

// Function to load user data with a token
async function loadUserData(token: string) {
    try {
        const profile = await fetchProfile(token);
        const playlists = await fetchPlaylists(token);
        
        console.log(profile);
        console.log(`Found ${playlists.length} playlists`);
        
        populateUI(profile);
        populatePlaylistsUI(playlists, token);
    } catch (error) {
        console.error("Error loading user data:", error);
        // If there's an auth error, clear token and redirect to login
        if (error instanceof Error && error.message.includes("401")) {
            localStorage.removeItem("spotify_token_info");
            redirectToAuthCodeFlow(clientId);
        }
    }
}

export async function redirectToAuthCodeFlow(clientId: string) {
    const verifier = generateCodeVerifier(128);
    const challenge = await generateCodeChallenge(verifier);

    localStorage.setItem("verifier", verifier);

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("response_type", "code");
    params.append("redirect_uri", "http://127.0.0.1:5173/callback");
    params.append("scope", scopes.join(" ")); // Use the scopes array
    params.append("code_challenge_method", "S256");
    params.append("code_challenge", challenge);

    document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function generateCodeVerifier(length: number) {
    let text = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function generateCodeChallenge(codeVerifier: string) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export async function getAccessToken(clientId: string, code: string): Promise<string> {
    const verifier = localStorage.getItem("verifier");

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", "http://127.0.0.1:5173/callback");
    params.append("code_verifier", verifier!);

    const result = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params
    });

    if (!result.ok) {
        throw new Error(`Token request failed: ${result.status} ${result.statusText}`);
    }

    const { access_token } = await result.json();
    return access_token;
}

async function fetchProfile(token: string): Promise<UserProfile> {
    const result = await fetch("https://api.spotify.com/v1/me", {
        method: "GET", headers: { Authorization: `Bearer ${token}` }
    });

    if (!result.ok) {
        throw new Error(`Profile fetch failed: ${result.status} ${result.statusText}`);
    }

    return await result.json();
}

// Fetch all user playlists with pagination
async function fetchPlaylists(token: string): Promise<Playlist[]> {
    const limit = 50; // Maximum number of playlists per request
    let offset = 0;
    let allPlaylists: Playlist[] = [];
    let hasMore = true;
    
    while (hasMore) {
        const response = await fetch(`https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${offset}`, {
            method: "GET", 
            headers: { Authorization: `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error(`Playlists fetch failed: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.items) {
            allPlaylists = [...allPlaylists, ...data.items];
            offset += limit;
            hasMore = data.items.length === limit && data.next !== null;
        } else {
            hasMore = false;
            console.log("No more playlists or error in response:", data);
        }
    }
    
    return allPlaylists;
}

// Fetch tracks in a playlist
async function fetchPlaylistTracks(token: string, playlistId: string): Promise<PlaylistTrack[]> {
    const limit = 100; // Maximum number of tracks per request
    let offset = 0;
    let allTracks: PlaylistTrack[] = [];
    let hasMore = true;
    
    try {
        while (hasMore) {
            const response = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`, {
                method: "GET", 
                headers: { Authorization: `Bearer ${token}` }
            });
            
            if (!response.ok) {
                throw new Error(`Error fetching tracks: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            
            if (data.items && data.items.length > 0) {
                // Filter out any null tracks (can happen with removed tracks)
                const validTracks = data.items.filter((item: PlaylistTrack) => item.track);
                allTracks = [...allTracks, ...validTracks];
                offset += limit;
                hasMore = data.items.length === limit && data.next !== null;
            } else {
                hasMore = false;
            }
        }
        
        // Sort tracks by popularity (highest to lowest)
        return allTracks.sort((a, b) => b.track.popularity - a.track.popularity);
    } catch (error) {
        console.error("Error fetching playlist tracks:", error);
        return [];
    }
}

// Format duration from milliseconds to MM:SS format
function formatDuration(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function populateUI(profile: UserProfile) {
    document.getElementById("displayName")!.innerText = profile.display_name;
    if (profile.images[0]) {
        const profileImage = new Image(200, 200);
        profileImage.src = profile.images[0].url;
        document.getElementById("avatar")!.appendChild(profileImage);
    }
    document.getElementById("id")!.innerText = profile.id;
    document.getElementById("email")!.innerText = profile.email;
    document.getElementById("uri")!.innerText = profile.uri;
    document.getElementById("uri")!.setAttribute("href", profile.external_urls.spotify);
    document.getElementById("url")!.innerText = profile.href;
    document.getElementById("url")!.setAttribute("href", profile.href);
    document.getElementById("imgUrl")!.innerText = profile.images[0]?.url ?? '(no profile image)';
}

// Updated function to populate the playlists section in the UI with click handlers
function populatePlaylistsUI(playlists: Playlist[], token: string) {
    const playlistsContainer = document.getElementById("playlists-container");
    if (!playlistsContainer) {
        console.error("Playlists container not found!");
        return;
    }

    // Clear existing content
    playlistsContainer.innerHTML = "";
    
    // Create header
    const header = document.createElement("h3");
    header.textContent = `Your Playlists (${playlists.length})`;
    playlistsContainer.appendChild(header);
    
    // Create list
    const list = document.createElement("ul");
    list.className = "playlists-list";
    
    // Add each playlist
    playlists.forEach(playlist => {
        const item = document.createElement("li");
        item.className = "playlist-item";
        item.dataset.playlistId = playlist.id;
        
        // Create playlist image if available
        const imageContainer = document.createElement("div");
        imageContainer.className = "playlist-image";
        if (playlist.images && playlist.images.length > 0) {
            const img = document.createElement("img");
            img.src = playlist.images[0].url;
            img.alt = `${playlist.name} cover`;
            img.width = 60;
            img.height = 60;
            imageContainer.appendChild(img);
        } else {
            // Add placeholder for playlists without images
            const placeholder = document.createElement("div");
            placeholder.className = "playlist-image-placeholder";
            placeholder.textContent = "🎵";
            imageContainer.appendChild(placeholder);
        }
        
        // Create playlist info
        const info = document.createElement("div");
        info.className = "playlist-info";
        
        const name = document.createElement("a");
        name.href = "#"; // We'll handle clicks via event listener
        name.textContent = playlist.name;
        name.className = "playlist-name";
        
        const details = document.createElement("div");
        details.className = "playlist-details";
        details.textContent = `${playlist.tracks.total} tracks • ${playlist.public ? 'Public' : 'Private'}`;
        
        info.appendChild(name);
        info.appendChild(details);
        
        // Add view tracks button
        const viewTracksBtn = document.createElement("button");
        viewTracksBtn.className = "view-tracks-btn";
        viewTracksBtn.textContent = "View Popular Tracks";
        info.appendChild(viewTracksBtn);
        
        // Add all elements to the list item
        item.appendChild(imageContainer);
        item.appendChild(info);
        
        // Add click event to show tracks
        item.addEventListener("click", async (e) => {
            // Prevent navigating to Spotify if clicking on the name link
            if (e.target instanceof HTMLAnchorElement) {
                e.preventDefault();
            }
            
            // Get existing track container and remove if exists (toggle behavior)
            const existingTrackContainer = document.getElementById(`tracks-${playlist.id}`);
            if (existingTrackContainer) {
                existingTrackContainer.remove();
                return;
            }
            
            // Remove any other open track lists
            document.querySelectorAll(".playlist-tracks-container").forEach(el => el.remove());
            
            // Create and append a loading indicator
            const loadingEl = document.createElement("div");
            loadingEl.className = "loading-indicator";
            loadingEl.textContent = "Loading tracks...";
            item.appendChild(loadingEl);
            
            try {
                // Fetch the tracks for this playlist
                const tracks = await fetchPlaylistTracks(token, playlist.id);
                
                // Create track container
                const trackContainer = document.createElement("div");
                trackContainer.id = `tracks-${playlist.id}`;
                trackContainer.className = "playlist-tracks-container";
                
                // Create track header
                const trackHeader = document.createElement("h4");
                trackHeader.textContent = `Most Popular Tracks in "${playlist.name}"`;
                trackContainer.appendChild(trackHeader);
                
                if (tracks.length === 0) {
                    const noTracks = document.createElement("p");
                    noTracks.textContent = "No tracks found in this playlist.";
                    trackContainer.appendChild(noTracks);
                } else {
                    // Create track list - only show top 10 most popular
                    const trackList = document.createElement("ul");
                    trackList.className = "tracks-list";
                    
                    // Get the top 10 or fewer tracks by popularity
                    const topTracks = tracks.slice(0, 10);
                    
                    topTracks.forEach((item, index) => {
                        const track = item.track;
                        
                        const trackItem = document.createElement("li");
                        trackItem.className = "track-item";
                        
                        // Add rank number
                        const rankEl = document.createElement("div");
                        rankEl.className = "track-rank";
                        rankEl.textContent = `${index + 1}`;
                        
                        // Add track info
                        const trackInfo = document.createElement("div");
                        trackInfo.className = "track-info";
                        
                        const trackName = document.createElement("a");
                        trackName.href = track.external_urls.spotify;
                        trackName.target = "_blank";
                        trackName.className = "track-name";
                        trackName.textContent = track.name;
                        
                        const artistsText = track.artists.map(artist => artist.name).join(", ");
                        const artistEl = document.createElement("div");
                        artistEl.className = "track-artist";
                        artistEl.textContent = artistsText;
                        
                        trackInfo.appendChild(trackName);
                        trackInfo.appendChild(artistEl);
                        
                        // Add album name
                        const albumEl = document.createElement("div");
                        albumEl.className = "track-album";
                        albumEl.textContent = track.album.name;
                        
                        // Add duration
                        const durationEl = document.createElement("div");
                        durationEl.className = "track-duration";
                        durationEl.textContent = formatDuration(track.duration_ms);
                        
                        // Add popularity indicator (closest thing to "most played")
                        const popularityEl = document.createElement("div");
                        popularityEl.className = "track-popularity";
                        
                        const popularityBar = document.createElement("div");
                        popularityBar.className = "popularity-bar";
                        
                        const popularityFill = document.createElement("div");
                        popularityFill.className = "popularity-fill";
                        popularityFill.style.width = `${track.popularity}%`;
                        
                        const popularityText = document.createElement("span");
                        popularityText.textContent = `${track.popularity}`;
                        
                        popularityBar.appendChild(popularityFill);
                        popularityEl.appendChild(popularityBar);
                        popularityEl.appendChild(popularityText);
                        
                        // Add play button if preview URL is available
                        if (track.preview_url) {
                            const previewBtn = document.createElement("button");
                            previewBtn.className = "preview-btn";
                            previewBtn.innerHTML = "▶️";
                            previewBtn.title = "Play preview";
                            previewBtn.addEventListener("click", (e) => {
                                e.stopPropagation();
                                
                                // Stop any currently playing previews
                                const allAudio = document.querySelectorAll("audio");
                                allAudio.forEach(audio => audio.pause());
                                
                                // Create and play audio
                                const audio = new Audio(track.preview_url!);
                                audio.play();
                            });
                            trackItem.appendChild(previewBtn);
                        }
                        
                        // Assemble track item
                        trackItem.appendChild(rankEl);
                        trackItem.appendChild(trackInfo);
                        trackItem.appendChild(albumEl);
                        trackItem.appendChild(durationEl);
                        trackItem.appendChild(popularityEl);
                        
                        trackList.appendChild(trackItem);
                    });
                    
                    trackContainer.appendChild(trackList);
                }
                
                // Remove the loading indicator
                loadingEl.remove();
                
                // Add "View all on Spotify" link
                const viewAllLink = document.createElement("a");
                viewAllLink.href = playlist.external_urls.spotify;
                viewAllLink.target = "_blank";
                viewAllLink.className = "view-all-link";
                viewAllLink.textContent = "View full playlist on Spotify";
                trackContainer.appendChild(viewAllLink);
                
                // Insert the track container after this playlist item
                item.parentNode!.insertBefore(trackContainer, item.nextSibling);
            } catch (error) {
                console.error("Error displaying tracks:", error);
                loadingEl.textContent = "Error loading tracks. Please try again.";
                setTimeout(() => loadingEl.remove(), 3000);
            }
        });
        
        // Add the list item to the list
        list.appendChild(item);
    });
    
    playlistsContainer.appendChild(list);
}

// Add a logout function
window.logout = function() {
    localStorage.removeItem("spotify_token_info");
    localStorage.removeItem("verifier");
    window.location.href = "/";
};

// Initialize the app
init();

export {}; // This export statement ensures this file is treated as a module