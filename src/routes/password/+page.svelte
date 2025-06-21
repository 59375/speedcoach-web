<script lang="ts">
  let pw = '';
  function login() {
    if (pw === 'sc_test_utrc') {
      localStorage.setItem('sc_pw_ok', '1');
      window.location.href = '/';
    } else { alert('Wrong password'); }
  }
</script>

<div class="h-screen flex flex-col items-center justify-center gap-4">
  <h1 class="text-2xl font-bold">SpeedCoach Analyzer – Login</h1>
  <input bind:value={pw} type="password" class="border p-2" />
  <button on:click={login} class="bg-blue-600 text-white px-4 py-2 rounded">Enter</button>
</div>