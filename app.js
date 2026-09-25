(() => {
	const config = window.LOOP_SUPABASE_CONFIG || {};
	const shell = document.querySelector(".shell");
	const authScreen = document.getElementById("auth-screen");
	const authForm = document.getElementById("auth-form");
	const authStatus = document.getElementById("auth-status");
	const inviteToken = new URLSearchParams(location.search).get("invite");
	let client;
	let user;
	let initializedUserId;
	let friends = [];
	let activeFriendId;
	let realtime;
	let signUpMode = Boolean(inviteToken);

	function message(text, error = false) {
		authStatus.textContent = text;
		authStatus.style.color = error ? "#a13f35" : "#67766a";
	}
	function showToast(text) {
		document.querySelector(".toast")?.remove();
		const toast = document.createElement("div");
		toast.className = "toast";
		toast.textContent = text;
		document.body.append(toast);
		window.setTimeout(() => toast.remove(), 3000);
	}
	function setAuthMode(signUp) {
		signUpMode = signUp;
		document.getElementById("signup-fields").hidden = !signUp;
		document.getElementById("auth-name").required = signUp;
		document.getElementById("auth-phone").required = signUp;
		document.getElementById("auth-password").autocomplete = signUp ? "new-password" : "current-password";
		document.getElementById("auth-title").textContent = signUp ? "Create your Loop account" : "Welcome to Loop";
		document.getElementById("auth-description").textContent = signUp ? "Create an account from this invitation. Email addresses are not verified." : "Sign in to message your friends.";
		document.getElementById("auth-submit").textContent = signUp ? "Create account" : "Sign in";
		const authToggle = document.getElementById("auth-toggle");
		authToggle.hidden = !inviteToken;
		authToggle.textContent = signUp ? "Already have an account? Sign in" : "Create an account";
		message("");
	}
	function normalizePhone(value) {
		const digits = value.trim().replace(/[^\d]/g, "");
		return digits.length >= 7 && digits.length <= 15 ? digits : null;
	}
	function initials(name) {
		return name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
	}
	function renderFriends(filter = "") {
		const list = document.getElementById("friend-list");
		const search = filter.trim().toLowerCase();
		const filtered = friends.filter((friend) => `${friend.display_name} ${friend.phone}`.toLowerCase().includes(search));
		document.getElementById("friend-count").textContent = String(friends.length);
		list.replaceChildren(...filtered.map((friend) => {
			const row = document.createElement("button");
			row.type = "button";
			row.className = `friend-row${activeFriendId === friend.friend_id ? " active" : ""}`;
			row.addEventListener("click", () => openConversation(friend.friend_id));
			const avatar = document.createElement("div");
			avatar.className = "friend-avatar";
			avatar.textContent = initials(friend.display_name);
			const copy = document.createElement("div");
			copy.className = "friend-copy";
			const name = document.createElement("span");
			name.className = "friend-name";
			name.textContent = friend.display_name;
			const preview = document.createElement("div");
			preview.className = "friend-preview";
			preview.textContent = friend.phone;
			copy.append(name, preview);
			row.append(avatar, copy);
			return row;
		}));
	}
	function renderInvites(invites) {
		const section = document.getElementById("invitation-section");
		const list = document.getElementById("invitation-list");
		section.hidden = invites.length === 0;
		document.getElementById("invitation-count").textContent = String(invites.length);
		list.replaceChildren(...invites.map((invite) => {
			const row = document.createElement("div");
			row.className = "invite-row";
			const symbol = document.createElement("div");
			symbol.className = "invite-symbol";
			symbol.textContent = "↗";
			const text = document.createElement("div");
			text.className = "invite-copy";
			const phone = document.createElement("strong");
			phone.textContent = `+${invite.phone}`;
			const status = document.createElement("small");
			status.textContent = "Waiting for registration";
			text.append(phone, status);
			row.append(symbol, text);
			return row;
		}));
	}
	async function loadInvites() {
		const { data, error } = await client.from("friend_invites").select("id, phone").eq("inviter_id", user.id).is("accepted_by", null).order("created_at", { ascending: false });
		if (error) { showToast(error.message); return; }
		renderInvites(data || []);
	}
	async function loadFriends() {
		const { data, error } = await client.rpc("my_friends");
		if (error) { showToast(error.message); return; }
		friends = data || [];
		renderFriends(document.getElementById("friend-search").value);
		if (!friends.length) {
			document.getElementById("empty-state").style.display = "grid";
			document.getElementById("conversation").style.display = "none";
			activeFriendId = undefined;
		} else if (activeFriendId && !friends.some((friend) => friend.friend_id === activeFriendId)) {
			activeFriendId = undefined;
		}
	}
	async function loadMessages(friendId) {
		const { data, error } = await client.from("messages").select("id,sender_id,recipient_id,body,created_at").or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`).order("created_at", { ascending: true });
		if (error) { showToast(error.message); return; }
		const rows = (data || []).filter((row) => row.sender_id === friendId || row.recipient_id === friendId);
		const container = document.getElementById("messages");
		container.replaceChildren(...rows.map((row) => {
			const wrapper = document.createElement("div");
			wrapper.className = `message${row.sender_id === user.id ? " mine" : ""}`;
			const bubble = document.createElement("div");
			bubble.className = "message-bubble";
			bubble.append(document.createTextNode(row.body));
			const time = document.createElement("time");
			time.className = "message-time";
			time.textContent = new Date(row.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
			bubble.append(time);
			wrapper.append(bubble);
			return wrapper;
		}));
		container.scrollTop = container.scrollHeight;
	}
	async function openConversation(friendId) {
		const friend = friends.find((item) => item.friend_id === friendId);
		if (!friend) return;
		activeFriendId = friendId;
		document.getElementById("empty-state").style.display = "none";
		document.getElementById("conversation").style.display = "grid";
		const avatar = document.getElementById("header-avatar");
		avatar.textContent = initials(friend.display_name);
		avatar.style.display = "grid";
		document.getElementById("header-title").textContent = friend.display_name;
		document.getElementById("header-subtitle").textContent = `+${friend.phone}`;
		document.getElementById("sidebar").classList.remove("open");
		renderFriends(document.getElementById("friend-search").value);
		await loadMessages(friendId);
	}
	async function acceptInviteIfPresent() {
		const token = inviteToken || localStorage.getItem("loop-pending-invite");
		if (!token) return;
		const { error } = await client.rpc("accept_friend_invite", { p_token: token });
		if (error) showToast(error.message);
		else showToast("Friend added. Say hello!");
		localStorage.removeItem("loop-pending-invite");
		history.replaceState({}, "", location.pathname);
	}
	async function connectUser(session) {
		if (initializedUserId === session.user.id) return;
		initializedUserId = session.user.id;
		user = session.user;
		shell.hidden = false;
		authScreen.hidden = true;
		document.querySelector(".side-footer-copy").firstChild.textContent = user.user_metadata?.display_name || user.email;
		await acceptInviteIfPresent();
		await Promise.all([loadFriends(), loadInvites()]);
		if (realtime) await client.removeChannel(realtime);
		realtime = client.channel(`loop-${user.id}`)
			.on("postgres_changes", { event: "*", schema: "public", table: "friendships", filter: `user_id=eq.${user.id}` }, () => loadFriends())
			.on("postgres_changes", { event: "INSERT", schema: "public", table: "friend_invites", filter: `inviter_id=eq.${user.id}` }, () => loadInvites())
			.on("postgres_changes", { event: "UPDATE", schema: "public", table: "friend_invites", filter: `inviter_id=eq.${user.id}` }, () => Promise.all([loadInvites(), loadFriends()]))
			.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${user.id}` }, () => activeFriendId && loadMessages(activeFriendId))
			.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `sender_id=eq.${user.id}` }, () => activeFriendId && loadMessages(activeFriendId))
			.subscribe();
	}
	async function createInvite() {
		const phoneInput = document.getElementById("friend-phone");
		const phone = normalizePhone(phoneInput.value);
		if (!phone) { showToast("Enter a valid phone number, including the country code."); return; }
		const { data, error } = await client.rpc("create_friend_invite", { p_phone: phone });
		if (error) { showToast(error.message); return; }
		const url = new URL(location.href);
		url.search = "";
		url.searchParams.set("invite", data);
		const inviteUrl = document.getElementById("invite-link");
		inviteUrl.value = url.href;
		document.getElementById("open-registration-link").href = url.href;
		document.getElementById("invite-recipient").textContent = `For +${phone}`;
		document.getElementById("invite-host-warning").hidden = !(location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname));
		addFriendDialog.close();
		inviteDialog.showModal();
		await loadInvites();
	}

	const addFriendDialog = document.getElementById("add-friend-dialog");
	const inviteDialog = document.getElementById("invite-dialog");
	document.getElementById("open-add-friend").addEventListener("click", () => addFriendDialog.showModal());
	document.getElementById("empty-add-friend").addEventListener("click", () => addFriendDialog.showModal());
	document.getElementById("cancel-add-friend").addEventListener("click", () => addFriendDialog.close());
	document.getElementById("add-friend-form").addEventListener("submit", async (event) => { event.preventDefault(); await createInvite(); });
	document.getElementById("close-invite").addEventListener("click", () => inviteDialog.close());
	document.getElementById("copy-invite").addEventListener("click", async () => {
		const link = document.getElementById("invite-link");
		try { await navigator.clipboard.writeText(link.value); showToast("Registration link copied."); }
		catch { link.select(); showToast(document.execCommand("copy") ? "Registration link copied." : "Select the link above and copy it."); }
	});
	document.getElementById("friend-search").addEventListener("input", (event) => renderFriends(event.target.value));
	document.getElementById("menu-toggle").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
	document.getElementById("about-button").addEventListener("click", async () => {
		if (confirm("Sign out of Loop?")) { await client.auth.signOut(); location.reload(); }
	});
	document.getElementById("message-form").addEventListener("submit", async (event) => {
		event.preventDefault();
		const body = document.getElementById("message-input").value.trim();
		if (!body || !activeFriendId) return;
		const { error } = await client.from("messages").insert({ sender_id: user.id, recipient_id: activeFriendId, body });
		if (error) { showToast(error.message); return; }
		document.getElementById("message-input").value = "";
		document.getElementById("send-button").disabled = true;
		await loadMessages(activeFriendId);
	});
	const composer = document.getElementById("message-input");
	composer.addEventListener("input", () => {
		document.getElementById("send-button").disabled = !composer.value.trim();
		composer.style.height = "auto";
		composer.style.height = `${Math.min(composer.scrollHeight, 110)}px`;
	});
	composer.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); document.getElementById("message-form").requestSubmit(); }
	});
	document.getElementById("auth-toggle").addEventListener("click", () => setAuthMode(!signUpMode));
	authForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		message("");
		const email = document.getElementById("auth-email").value.trim();
		const password = document.getElementById("auth-password").value;
		let result;
		if (signUpMode) {
			if (!inviteToken) { message("Create an account using a friend's invite link.", true); return; }
			const phone = normalizePhone(document.getElementById("auth-phone").value);
			const name = document.getElementById("auth-name").value.trim();
			if (!phone || !name) { message("Enter your name and a valid phone number.", true); return; }
			if (inviteToken) localStorage.setItem("loop-pending-invite", inviteToken);
			const redirect = new URL(location.href);
			redirect.search = "";
			if (inviteToken) redirect.searchParams.set("invite", inviteToken);
			result = await client.auth.signUp({ email, password, options: { emailRedirectTo: redirect.href, data: { display_name: name, phone } } });
			if (!result.error && !result.data.session) { message("Check your email to confirm your account, then sign in here."); return; }
		} else {
			result = await client.auth.signInWithPassword({ email, password });
		}
		if (result.error) { message(result.error.message, true); return; }
		if (result.data.session) await connectUser(result.data.session);
	});

	if (!config.url || !config.publicKey || !window.supabase?.createClient) {
		shell.hidden = true;
		authScreen.hidden = false;
		document.getElementById("auth-form").hidden = true;
		document.getElementById("backend-note").hidden = false;
		return;
	}
	client = window.supabase.createClient(config.url, config.publicKey);
	setAuthMode(Boolean(inviteToken));
	if (inviteToken) {
		client.rpc("get_invite_phone", { p_token: inviteToken }).then(({ data, error }) => {
			if (!error && data) { document.getElementById("auth-phone").value = `+${data}`; document.getElementById("auth-phone").readOnly = true; }
		});
	}
	client.auth.onAuthStateChange((_event, session) => {
		if (session) queueMicrotask(() => connectUser(session));
		else { initializedUserId = undefined; shell.hidden = true; authScreen.hidden = false; }
	});
	client.auth.getSession().then(({ data }) => {
		if (data.session) connectUser(data.session);
		else { shell.hidden = true; authScreen.hidden = false; }
	});
})();