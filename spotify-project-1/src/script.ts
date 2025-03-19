const clientId = "1fd1e055d2704f3bbec35e869034d71b";
const params = new URLSearchParams(window.location.search);
const code = params.get("code");
const scopes = [
  "user-read-private",
  "user-read-email",
  "playlist-read-private",
  "playlist-read-collaborative"
];

if (!code) {
    redirectToAuthCodeFlow(clientId);
} else {
    const accessToken = await getAccessToken(clientId, code);
    const profile = await fetchProfile(accessToken);
    const playlists = await fetchPlaylists(accessToken);

    console.log(profile);
    console.log(`Found ${playlists.length} playlists`);

    populateUI(profile);
    populatePlaylistsUI(playlists);
}

export async function redirectToAuthCodeFlow(clientId: string) {
    const verifier = generateCodeVerifier(128);
    const challenge = await generateCodeChallenge(verifier);

    localStorage.setItem("verifier", verifier);

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("response_type", "code");
    params.append("redirect_uri", "http://127.0.0.1:5173/callback");
    params.append("scope", scopes.join(" "));
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

    const { access_token } = await result.json();
    return access_token;
}

async function fetchProfile(token: string): Promise<UserProfile> {
    const result = await fetch("https://api.spotify.com/v1/me", {
        method: "GET", headers: { Authorization: `Bearer ${token}` }
    });

    return await result.json();
}

async function fetchPlaylists(token: string): Promise<Playlist[]> {
    const limit = 50;
    let offset = 0;
    let allPlaylists: Playlist[] = [];
    let hasMore = true;

    while (hasMore) {
        const response = await fetch(`https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${offset}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` }
        });

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

function populatePlaylistsUI(playlists: Playlist[]) {
    const playlistsContainer = document.getElementById("playlists-container");
    if (!playlistsContainer) {
        console.error("Playlists container not found!");
        return;
    }

    playlistsContainer.innerHTML = "";

    const header = document.createElement("h3");
    header.textContent = `Your Playlists (${playlists.length})`;
    playlistsContainer.appendChild(header);

    const list = document.createElement("ul");
    list.className = "playlists-list";

    playlists.forEach(playlist => {
        const item = document.createElement("li");
        item.className = "playlist-item";

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
            const placeholder = document.createElement("div");
            placeholder.className = "playlist-image-placeholder";
            placeholder.textContent = "🎵";
            imageContainer.appendChild(placeholder);
        }

        const info = document.createElement("div");
        info.className = "playlist-info";

        const name = document.createElement("a");
        name.href = playlist.external_urls.spotify;
        name.target = "_blank";
        name.textContent = playlist.name;
        name.className = "playlist-name";

        const details = document.createElement("div");
        details.className = "playlist-details";
        details.textContent = `${playlist.tracks.total} tracks • ${playlist.public ? 'Public' : 'Private'}`;

        info.appendChild(name);
        info.appendChild(details);

        item.appendChild(imageContainer);
        item.appendChild(info);

        list.appendChild(item);
    });

    playlistsContainer.appendChild(list);
}