"""Deploy with: modal deploy modal_app.py"""
from pathlib import Path
import subprocess
import modal

image = (modal.Image.debian_slim(python_version='3.12')
         .pip_install_from_requirements('dashboard/requirements.txt')
         .add_local_dir(Path(__file__).parent / 'dashboard', remote_path='/app/dashboard'))
app = modal.App('space-cadet-dashboard', image=image)


@app.function(secrets=[modal.Secret.from_name('space-cadet-supabase')],
              cpu=1, memory=2048, timeout=3600, scaledown_window=300, max_containers=2)
@modal.concurrent(max_inputs=50)
@modal.web_server(8000, startup_timeout=120)
def dashboard():
    subprocess.Popen(['python', '-m', 'streamlit', 'run', '/app/dashboard/app.py',
                      '--server.address=0.0.0.0', '--server.port=8000',
                      '--server.headless=true', '--browser.gatherUsageStats=false',
                      '--theme.base=dark', '--theme.primaryColor=#5ef2ff'])
